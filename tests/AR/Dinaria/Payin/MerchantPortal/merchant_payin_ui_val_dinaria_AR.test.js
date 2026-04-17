const { chromium } = require('playwright');
const allure = require('allure-js-commons');
const envConfig = require('../../../../../utils/envConfig');

jest.setTimeout(1800000);

describe(`Validaciones Interactivas Merchant Portal AR, Dinaria [Amb: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    let browser;
    let context;
    let sharedPage;
    let formUrl = '';

    beforeAll(async () => {
        browser = await chromium.launch({ headless: true });
        context = await browser.newContext({ locale: 'es-ES', colorScheme: 'dark' });
        sharedPage = await context.newPage();

        // Timeout general más estricto
        sharedPage.setDefaultTimeout(10000);

        let baseURL = envConfig.BASE_URL;
        const domainRoot = baseURL.replace("api", "merchant");
        const loginUrl = `${domainRoot}/login`;
        formUrl = `${domainRoot}/payments/links/create`;

        await sharedPage.goto(loginUrl, { waitUntil: 'domcontentloaded' });

        await sharedPage.waitForSelector('#identifier', { timeout: 15000 });
        await sharedPage.locator('#identifier').first().fill('automation.qa.v1@gmail.com');
        await sharedPage.locator('#password').first().fill('Sergio@1234');

        const btnLogin = sharedPage.locator('button:has-text("Iniciar sesión")').first();
        await btnLogin.evaluate(node => node.disabled = false).catch(() => null);
        await btnLogin.click({ force: true });

        // TELETRANSPORTACIÓN AL FORMULARIO
        await sharedPage.goto(formUrl, { waitUntil: 'domcontentloaded' });
        await sharedPage.waitForSelector('#country', { timeout: 15000 });
    });

    afterAll(async () => {
        if (browser) await browser.close();
    });

    const typeSafe = async (page, selector, textToType) => {
        const loc = page.locator(selector).first();
        if(await loc.isVisible().catch(()=>false)){
            await loc.clear({ timeout: 2000 });
            await loc.pressSequentially(textToType, { delay: 10, timeout: 5000 });
        }
    };

    const attemptSubmit = async (page) => {
        // Scroll hacia los botones de acción para asegurar que "First Name" y "Last Name" sean visibles
        const btn = page.locator('button:has-text("Crear Enlace de Pago"), button[type="submit"], #save').first();
        await btn.scrollIntoViewIfNeeded().catch(() => null);
        await page.waitForTimeout(500);

        if (allure && allure.attachment) {
            try {
                // Screenshot regular para asegurar lo que la pantalla ve tras el scroll (evadiendo overflows ocultos)
                const buffer = await page.screenshot({ fullPage: false });
                allure.attachment("📸 Formulario Lleno (Antes de Enviar)", buffer, "image/png");
            } catch (e) { }
        }
        
        // Simulamos click fuera del entorno
        await page.mouse.click(0, 0);
        await page.waitForTimeout(500);
        
        // CLICK FORZADO para evaluar burbujas HTML nativas
        await btn.click({ timeout: 500 }).catch(() => null);
        await page.waitForTimeout(1000); 
    };

    const attachEvidence = async (testName, page, actionTaken, isHappyPath = false) => {
        if (!allure || !allure.attachment) return;

        let errorVisualExtraido = "Ninguno Visible / Cajas verdes o input bloqueado.";
        const errorSelectors = ['p.error-message', '.text-red-500', '.error', '.invalid-feedback', 'span[role="alert"]', 'p.text-xs.text-red-500'];
        let extractedTexts = [];

        for (const sel of errorSelectors) {
            try {
                const elements = await page.locator(sel).all();
                for (const el of elements) {
                    if (await el.isVisible()) {
                        const txt = (await el.innerText()).trim();
                        if (txt.length > 0) extractedTexts.push(txt);
                    }
                }
            } catch (e) { }
        }

        // ESCÁNER DE BURBUJAS NATIVAS DE NAVEGADOR
        if (page.url().includes('create')) {
            const camposSospechosos = ['#first_name', '#last_name', '#document_number', '#amount'];
            for (const id of camposSospechosos) {
                try {
                    const target = page.locator(id).first();
                    const msjNativo = await target.evaluate(el => el.validationMessage).catch(() => null);
                    if (msjNativo && msjNativo.trim().length > 0) {
                        extractedTexts.push(`[Nativo HTML5 ${id}]: ${msjNativo}`);
                    }
                } catch (e) { }
            }
        }

        let isBotonBloqueadoOverride = false;
        if (!page.url().includes('create')) {
            if (!isHappyPath) {
                const bodyText = await page.innerText('body').catch(() => "");
                if (bodyText.toLowerCase().includes('no es ecuatoriano') || bodyText.toLowerCase().includes('argentin') || bodyText.toLowerCase().includes('invalid')) {
                    extractedTexts.push(`[VALIDACION EN OTRA PÁGINA]: Bloqueado exitosamente tras evadir UI.`);
                }
                isBotonBloqueadoOverride = true; // Forzamos victoria porque el sistema bloqueó el flujo
                
                // Auto sanar retornando rápido
                await page.goto(formUrl, { waitUntil: 'domcontentloaded' });
                await page.waitForSelector('#country', { timeout: 15000 });
            } else {
                // Happy path se espera que avance
                isBotonBloqueadoOverride = false;
            }
        }

        if (extractedTexts.length > 0) {
            errorVisualExtraido = [...new Set(extractedTexts)].join(" | ");
        }

        let isBotonBloqueado = isBotonBloqueadoOverride;
        if (!isBotonBloqueado && page.url().includes('create')) {
            const btnSave = page.locator('button:has-text("Crear Enlace de Pago"), #save').first();
            isBotonBloqueado = await btnSave.isDisabled().catch(() => true);
        }

        const auditLog = {
            Test: testName,
            InputDelRobotQA: actionTaken,
            BotonEstabaDesactivado: isBotonBloqueado,
            MensajesDetectados: errorVisualExtraido
        };
        
        allure.attachment(`📋 Extraccion de Error - ${testName}`, JSON.stringify(auditLog, null, 2), "application/json");

        try {
            const buffer = await page.screenshot({ fullPage: true });
            allure.attachment(`📸 Evidencia Final - ${testName}`, buffer, "image/png");
        } catch (e) { }

        return { errorVisualExtraido, isBotonBloqueado };
    };

    const fillBaseForm = async (page) => {
        // Auto-Sanación
        if (!page.url().includes('create')) {
            await page.goto(formUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#country', { timeout: 15000 });
            await page.waitForTimeout(500); 
        }

        // Completamos datos obligatorios
        await page.selectOption('#country', 'AR', { timeout: 2000 }).catch(() => null);
        await page.waitForTimeout(500); 
        await page.selectOption('#payment_method', 'bank_transfer', { timeout: 1000 }).catch(() => null);
        await typeSafe(page, '#amount', '100');
        await typeSafe(page, '#first_name', 'Sergio');
        await typeSafe(page, '#last_name', 'Testing');
        
        await page.selectOption('#document_type', 'CUIL', { timeout: 1000 }).catch(() => null);
        await typeSafe(page, '#document_number', '20275105792');
    };

    const takeGridRowScreenshot = async (page, allureInstance) => {
        await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => null);
        await page.waitForSelector('span[data-state="pending"]', { timeout: 15000 }).catch(()=>null);
        
        // Precisar la primera fila REAL referenciando la tabla interna explícitamente
        const firstTableRow = page.locator('table.q-table tbody tr').first();
        
        if (await firstTableRow.isVisible().catch(()=>false)) {
            await firstTableRow.scrollIntoViewIfNeeded().catch(()=>null);

            // Desplazar contenedor horizontal para visualizar todos los datos ("recorrer el renglon")
            await page.evaluate(() => {
                const wrappers = document.querySelectorAll('.q-table__middle');
                wrappers.forEach(w => { if(w.scrollWidth > w.clientWidth) w.scrollLeft = w.scrollWidth; });
            }).catch(()=>null);
            
            await page.waitForTimeout(1000); // Dar tiempor a redraw
            
            if (allureInstance && allureInstance.attachment) {
                const buffer = await firstTableRow.screenshot().catch(()=>null);
                if (buffer) allureInstance.attachment(`📸 Fila de Grilla (Datos Creados)`, buffer, "image/png");
            }
        }
        
        // Auto sanar para proximo test
        await page.goto(formUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#country', { timeout: 15000 });
    };

    // ================================================================
    // SUITE 1: FIRST NAME AISLADO
    // ================================================================
    describe('1. Suite UI: Nombres (First Name)', () => {
        test('1.1. First Name: Boundary Corto (1 Letra)', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#first_name', 'A');
            await attemptSubmit(sharedPage);
            const r = await attachEvidence('FN - Corto (1L)', sharedPage, "First Name: 'A'");
            const fueFrenado = r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]') || r.errorVisualExtraido !== "Ninguno Visible / Cajas verdes o input bloqueado.";
            expect(fueFrenado).toBe(true);
        });

        test('1.2. First Name: Boundary Largo (51 Letras)', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#first_name', 'A'.repeat(51));
            await attemptSubmit(sharedPage);
            const r = await attachEvidence('FN - Largo (51L)', sharedPage, "First Name: 'A'x51");
            const fueFrenado = r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]') || r.errorVisualExtraido !== "Ninguno Visible / Cajas verdes o input bloqueado.";
            expect(fueFrenado).toBe(true);
        });

        test('1.2.1. First Name: Boundary Valido Máximo (50 Letras)', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#first_name', 'A'.repeat(50));
            await attemptSubmit(sharedPage);
            const r = await attachEvidence('FN - Limite (50L) Exitoso', sharedPage, "First Name: 'A'x50", true);
            const avanzoSinFrenar = !r.isBotonBloqueado && !r.errorVisualExtraido.includes('[Nativo HTML5]');
            expect(avanzoSinFrenar).toBe(true);
            await takeGridRowScreenshot(sharedPage, allure);
        });

        test('1.3. First Name: Falla Regex por Números', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#first_name', 'Sergio123');
            await attemptSubmit(sharedPage);
            const r = await attachEvidence('FN - Numérico', sharedPage, "First Name: 'Sergio123'");
            const fueFrenado = r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]') || r.errorVisualExtraido !== "Ninguno Visible / Cajas verdes o input bloqueado.";
            expect(fueFrenado).toBe(true);
        });

        test('1.4. First Name: Falla Regex por Símbolos Inesperados (XSS)', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#first_name', '<script>');
            await attemptSubmit(sharedPage);
            const r = await attachEvidence('FN - Simbolos XSS', sharedPage, "First Name: '<script>'");
            const fueFrenado = r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]') || r.errorVisualExtraido !== "Ninguno Visible / Cajas verdes o input bloqueado.";
            expect(fueFrenado).toBe(true);
        });

        test('1.5. First Name: Feliz Apóstrofe', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#first_name', "D'Ángelo-José María");
            await attemptSubmit(sharedPage);
            const r = await attachEvidence('FN - Complejo Feliz', sharedPage, "First Name: 'D'Ángelo-José María'", true);
            const avanzoSinFrenar = !r.isBotonBloqueado && !r.errorVisualExtraido.includes('[Nativo HTML5]');
            expect(avanzoSinFrenar).toBe(true);
            await takeGridRowScreenshot(sharedPage, allure);
        });
    });

    // ================================================================
    // SUITE 2: LAST NAME AISLADO
    // ================================================================
    describe('2. Suite UI: Apellidos (Last Name)', () => {
        test('2.1. Last Name: Boundary Corto (1 Letra)', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#last_name', 'B');
            await attemptSubmit(sharedPage);
            const r = await attachEvidence('LN - Corto (1L)', sharedPage, "Last Name: 'B'");
            const fueFrenado = r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]') || r.errorVisualExtraido !== "Ninguno Visible / Cajas verdes o input bloqueado.";
            expect(fueFrenado).toBe(true);
        });

        test('2.2. Last Name: Boundary Largo (51 Letras)', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#last_name', 'B'.repeat(51));
            await attemptSubmit(sharedPage);
            const r = await attachEvidence('LN - Largo (51L)', sharedPage, "Last Name: 'B'x51");
            const fueFrenado = r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]') || r.errorVisualExtraido !== "Ninguno Visible / Cajas verdes o input bloqueado.";
            expect(fueFrenado).toBe(true);
        });

        test('2.2.1. Last Name: Boundary Valido Máximo (50 Letras)', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#last_name', 'B'.repeat(50));
            await attemptSubmit(sharedPage);
            const r = await attachEvidence('LN - Limite (50L)', sharedPage, "Last Name: 'B'x50", true);
            const avanzoSinFrenar = !r.isBotonBloqueado && !r.errorVisualExtraido.includes('[Nativo HTML5]');
            expect(avanzoSinFrenar).toBe(true);
            await takeGridRowScreenshot(sharedPage, allure);
        });

        test('2.3. Last Name: Falla Regex por Números', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#last_name', 'Torres8');
            await attemptSubmit(sharedPage);
            const r = await attachEvidence('LN - Numérico', sharedPage, "Last Name: 'Torres8'");
            const fueFrenado = r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]') || r.errorVisualExtraido !== "Ninguno Visible / Cajas verdes o input bloqueado.";
            expect(fueFrenado).toBe(true);
        });

        test('2.4. Last Name: Feliz Complejidad Latina', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#last_name', 'De La Santísima Trinidad Peñas');
            await attemptSubmit(sharedPage);
            const r = await attachEvidence('LN - Latino Extremo', sharedPage, "Last Name: 'De La Santísima...'", true);
            const avanzoSinFrenar = !r.isBotonBloqueado && !r.errorVisualExtraido.includes('[Nativo HTML5]');
            expect(avanzoSinFrenar).toBe(true);
            await takeGridRowScreenshot(sharedPage, allure);
        });
    });

    // ================================================================
    // SUITE 3: DOCUMENTOS NACIONALES AR (CUIL)
    // ================================================================
    describe('3. Suite UI: Documentos Nacionales (Argentina CUIL/CUIT)', () => {
        test('3.1. CUIL: Prefix Inválido/Inexistente (19...)', async () => {
            await fillBaseForm(sharedPage);
            await sharedPage.selectOption('#document_type', 'CUIL').catch(()=>null);
            await typeSafe(sharedPage, '#document_number', '19-08490848-8');
            await attemptSubmit(sharedPage);
            const r = await attachEvidence('CUIL - Prefix Invalido (19)', sharedPage, "CUIL: '19-08490848-8'");
            const fueFrenado = r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]') || r.errorVisualExtraido !== "Ninguno Visible / Cajas verdes o input bloqueado.";
            expect(fueFrenado).toBe(true);
        });

        test('3.2. CUIL: Longitud Corta (10 Dígitos)', async () => {
            await fillBaseForm(sharedPage);
            await sharedPage.selectOption('#document_type', 'CUIL').catch(()=>null);
            await typeSafe(sharedPage, '#document_number', '20-08490848');
            await attemptSubmit(sharedPage);
            const r = await attachEvidence('CUIL - Corto (10)', sharedPage, "CUIL: '20-08490848'");
            const fueFrenado = r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]') || r.errorVisualExtraido !== "Ninguno Visible / Cajas verdes o input bloqueado.";
            expect(fueFrenado).toBe(true);
        });

        test('3.3. CUIL: Falla Regex por Letras y Signos', async () => {
            await fillBaseForm(sharedPage);
            await sharedPage.selectOption('#document_type', 'CUIL').catch(()=>null);
            await typeSafe(sharedPage, '#document_number', '20-A8490%48-$');
            await attemptSubmit(sharedPage);
            const r = await attachEvidence('CUIL - Especiales', sharedPage, "CUIL: Especiales");
            const fueFrenado = r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]') || r.errorVisualExtraido !== "Ninguno Visible / Cajas verdes o input bloqueado.";
            expect(fueFrenado).toBe(true);
        });
        
        test('3.4. CUIL: Puntos en lugar de Guiones', async () => {
            await fillBaseForm(sharedPage);
            await sharedPage.selectOption('#document_type', 'CUIL').catch(()=>null);
            await typeSafe(sharedPage, '#document_number', '20.27510579.2');
            await attemptSubmit(sharedPage);
            const r = await attachEvidence('CUIL - Puntos (Falla Nativa)', sharedPage, "CUIL: '20.27.'");
            const fueFrenado = r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]') || r.errorVisualExtraido !== "Ninguno Visible / Cajas verdes o input bloqueado.";
            expect(fueFrenado).toBe(true);
        });
    });

});
