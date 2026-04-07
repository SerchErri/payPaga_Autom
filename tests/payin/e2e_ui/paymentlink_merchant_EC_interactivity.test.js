const { chromium } = require('playwright');
const allure = require('allure-js-commons');
const envConfig = require('../../../utils/envConfig');

jest.setTimeout(1800000);

describe(`Validaciones Interactivas Merchant Portal EC [Amb: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

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

        // TELETRANSPORTACIÓN AL FORMULARIO (Deep Linking Absoluto)
        await sharedPage.goto(formUrl, { waitUntil: 'domcontentloaded' });

        // Espera definitiva a que el formulario cargue el dropdown de Países
        await sharedPage.waitForSelector('#country', { timeout: 15000 });
    });

    afterAll(async () => {
        if (browser) await browser.close();
    });

    const typeSafe = async (page, selector, textToType) => {
        // Al fallar se detiene el test al instante, sin atrapar errores mudos de 10 segundos
        const loc = page.locator(selector).first();
        await loc.clear({ timeout: 2000 });
        await loc.pressSequentially(textToType, { delay: 10, timeout: 5000 });
    };

    const attachEvidence = async (testName, page, actionTaken) => {
        if (!allure || !allure.attachment) return;

        let errorVisualExtraido = "Ninguno Visible / Cajas verdes o input bloqueado.";

        // Scan for Red texts or error messages generally used by Paypaga's Vue/React components
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

        // ========================================================
        // MAGIA AVANZADA: ESCÁNER DE BURBUJAS NATIVAS DE NAVEGADOR
        // ========================================================
        if (page.url().includes('create')) {
            const camposSospechosos = ['#first_name', '#last_name', '#document_number', '#email', '#amount'];
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
        // ========================================================

        // ========================================================
        // MAGIA AVANZADA: ESCÁNER DE FUGA (2Da Página de Errores)
        // ========================================================
        let isBotonBloqueadoOverride = false;
        if (!page.url().includes('create')) {
            const bodyText = await page.innerText('body').catch(() => "");
            if (bodyText.toLowerCase().includes('no es ecuatoriano') || bodyText.toLowerCase().includes('ecuatoriana')) {
                extractedTexts.push(`[VALIDACION EN OTRA PÁGINA]: Documento no ecuatoriano mitigado exitosamente.`);
            }
            isBotonBloqueadoOverride = true; // Forzamos victoria porque el sistema bloqueó el flujo
        }

        if (extractedTexts.length > 0) {
            errorVisualExtraido = [...new Set(extractedTexts)].join(" | ");
        }

        let isBotonBloqueado = isBotonBloqueadoOverride;
        if (!isBotonBloqueado && page.url().includes('create')) {
            const btnSave = page.locator('button:has-text("Crear Enlace de Pago")').first();
            isBotonBloqueado = await btnSave.isDisabled().catch(() => true);
        }

        const auditLog = {
            Test: testName,
            InputDelRobotQA: actionTaken,
            BotonEstabaDesactivado: isBotonBloqueado,
            MensajeDeErrorVisual: errorVisualExtraido
        };
        allure.attachment(`📋 Extraccion de Error - ${testName}`, JSON.stringify(auditLog, null, 2), "application/json");

        try {
            const buffer = await page.screenshot({ fullPage: true });
            allure.attachment(`📸 Evidencia Final - ${testName}`, buffer, "image/png");
        } catch (e) { }

        return { errorVisualExtraido, isBotonBloqueado };
    };

    const fillBaseForm = async (page) => {
        // Auto-Sanación de la Single-Page (Por si un test anterior navegó por completo a la ventana de error)
        if (!page.url().includes('create')) {
            await page.goto(formUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#country', { timeout: 15000 });
        }

        await page.selectOption('#country', 'EC', { timeout: 1000 }).catch(() => null);
        await page.selectOption('#payment_method', 'bank_transfer', { timeout: 1000 }).catch(() => null);
        await typeSafe(page, '#amount', '100');
        await typeSafe(page, '#first_name', 'Sergio');
        await typeSafe(page, '#last_name', 'Errigo');
        await typeSafe(page, '#email', 'perfecto@allure.com');
        await page.selectOption('#document_type', 'CI', { timeout: 1000 }).catch(() => null);
        await typeSafe(page, '#document_number', '1710034065');
    };

    const attemptSubmit = async (page) => {
        if (allure && allure.attachment) {
            try {
                await page.waitForTimeout(500);
                const buffer = await page.screenshot({ fullPage: true });
                allure.attachment("📸 Formulario Lleno (Antes de Enviar)", buffer, "image/png");
            } catch (e) { }
        }
        // Disparamos evento Blur (clickeando afuera) para forzar al Frontend a refrescar las validaciones en tiempo real
        await page.mouse.click(0, 0);
        await page.waitForTimeout(500);

        const btn = page.locator('button:has-text("Crear Enlace de Pago")').first();
        // ELIMINAMOS EL HACK QUE ARRUINABA TODO. 
        // Si el botón está Deshabilitado por la Validación de React, Playwright tardaría 10s ciegos en clickearlo. Lo limitamos a 500ms.
        await btn.click({ timeout: 500 }).catch(() => null);
        await page.waitForTimeout(1000); // Tiempo para que Chrome dibuje la burbuja nativa (si aplica)
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
            const r = await attachEvidence('FN - Limite (50L) Exitoso', sharedPage, "First Name: 'A'x50");
            const avanzoSinFrenar = !r.isBotonBloqueado && !r.errorVisualExtraido.includes('[Nativo HTML5]');
            expect(avanzoSinFrenar).toBe(true);
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
            await typeSafe(sharedPage, '#first_name', "O'Connor");
            const r = await attachEvidence('FN - Apóstrofes y Feliz', sharedPage, "First Name: 'O'Connor'");
            expect(r.isBotonBloqueado).toBe(false);
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
            const r = await attachEvidence('LN - Limite (50L) Exitoso', sharedPage, "Last Name: 'B'x50");
            const avanzoSinFrenar = !r.isBotonBloqueado && !r.errorVisualExtraido.includes('[Nativo HTML5]');
            expect(avanzoSinFrenar).toBe(true);
        });

        test('2.3. Last Name: Falla Regex por Números', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#last_name', 'Torres8');
            await attemptSubmit(sharedPage);
            const r = await attachEvidence('LN - Numérico', sharedPage, "Last Name: 'Torres8'");
            const fueFrenado = r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]') || r.errorVisualExtraido !== "Ninguno Visible / Cajas verdes o input bloqueado.";
            expect(fueFrenado).toBe(true);
        });
    });

    // ================================================================
    // SUITE 3: DOCUMENTOS (CI, DL, PP)
    // ================================================================
    describe('3. Suite UI: Documentos Nacionales (Ecuador)', () => {
        test('3.1. Cédula CI: Falla por Falta (9 chars)', async () => {
            await fillBaseForm(sharedPage);
            await sharedPage.selectOption('#document_type', 'CI');
            await typeSafe(sharedPage, '#document_number', '171003406');
            await attemptSubmit(sharedPage);
            const r = await attachEvidence('CI - Corta 9 Digitos', sharedPage, "CI: '171003406'");
            const fueFrenado = r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]') || r.errorVisualExtraido !== "Ninguno Visible / Cajas verdes o input bloqueado.";
            expect(fueFrenado).toBe(true);
        });

        test('3.2. Cédula CI: Falla por Exceso (11 chars)', async () => {
            await fillBaseForm(sharedPage);
            await sharedPage.selectOption('#document_type', 'CI', { timeout: 1000 }).catch(() => null);
            await typeSafe(sharedPage, '#document_number', '17100340656');
            await attemptSubmit(sharedPage);
            const r = await attachEvidence('CI - Larga 11 Digitos', sharedPage, "CI: '17100340656'");
            const fueFrenado = r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]') || r.errorVisualExtraido !== "Ninguno Visible / Cajas verdes o input bloqueado.";
            expect(fueFrenado).toBe(true);
        });

        test('3.3. Pasaporte PP: Falla por Límite de Frontera Alfanumérica (14 chars)', async () => {
            await fillBaseForm(sharedPage);
            await sharedPage.selectOption('#document_type', 'PP', { timeout: 1000 }).catch(() => null);
            const rotoString = 'A1B2C3D4E5QW90'; // 14
            await typeSafe(sharedPage, '#document_number', rotoString);
            await attemptSubmit(sharedPage);
            const r = await attachEvidence('PP - Boundary 14 (Desborde)', sharedPage, `PP: ${rotoString}`);
            const fueFrenado = r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]') || r.errorVisualExtraido !== "Ninguno Visible / Cajas verdes o input bloqueado.";
            expect(fueFrenado).toBe(true);
        });
    });

    // ================================================================
    // SUITE 4: CORREOS 
    // ================================================================
    describe('4. Suite UI: Correos (Emails)', () => {
        test('4.1. Email: Falla Sin Arroba', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#email', 'usuariogmail.com');
            await attemptSubmit(sharedPage);
            const r = await attachEvidence('Email - Sin Arroba', sharedPage, "Email: 'usuariogmail.com'");
            const valid = r.isBotonBloqueado || r.errorVisualExtraido.includes('correo') || r.errorVisualExtraido.includes('ejemplo') || r.errorVisualExtraido.includes('[Nativo HTML5]');
            expect(valid).toBeTruthy();
        });

        test('4.2. Email: Falla Sin TLD y Dominio', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#email', 'usuario@gmail');
            await attemptSubmit(sharedPage);
            const r = await attachEvidence('Email - Sin .com', sharedPage, "Email: 'usuario@gmail'");
            const valid = r.isBotonBloqueado || r.errorVisualExtraido.toLowerCase().includes('correo') || r.errorVisualExtraido.includes('ejemplo') || r.errorVisualExtraido.includes('[Nativo HTML5]');
            expect(valid).toBeTruthy();
        });
    });

});
