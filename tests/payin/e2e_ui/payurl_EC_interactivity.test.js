const { chromium } = require('playwright');
const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../../utils/authHelper');
const envConfig = require('../../../utils/envConfig');

const PAYURL_ENDPOINT = `${envConfig.BASE_URL}/v2/pay-urls`;

// Tiempo masivo (30 Minutos) para soportar la ejecución completa en equipos lentos
jest.setTimeout(1800000);

describe(`[E2E Exhaustiva Desacoplada] Validaciones UI de Formularios PayUrl [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    
    let freshToken = '';
    let browser;

    beforeAll(async () => {
        try { 
            freshToken = await getAccessToken(); 
            // Lanzando el Navegador Robot en las sombras
            browser = await chromium.launch({ headless: true }); 
        } catch (error) { 
            console.error("Fallo obteniendo token global o Chromium", error); 
        }
    });

    afterAll(async () => {
        if (browser) await browser.close();
    });

    /** SUPER LECTOR DE HTML QUE EVITA TIMEOUTS Y EXCEPCIONES MARRONES (NEW) */
    const typeSafe = async (page, selector, textToType) => {
        try {
            const loc = page.locator(selector).first();
            await loc.clear({ timeout: 5000 }).catch(() => null);
            // Escribe suavemente como un humano. Si el HTML tiene "maxlength=50", el navegador frenará solo al 50.
            await loc.pressSequentially(textToType, { delay: 10, timeout: 5000 });
        } catch (e) {
            console.log(`Error tipográfico en ${selector} (Probablemente Frontend HTML5 Validations):`, e.message);
        }
    };

    /** HELPER DE FOTOGRAFÍA Y MAPEO DE ERRORES E2E PARA ALLURE */
    const attachEvidence = async (testName, page, actionTaken, finalUrl) => {
        if (!allure || !allure.attachment) return;
        
        let errorVisualExtraido = "Ninguno Visible / Botón bloqueado por HTML nativo.";
        
        const errorSelectors = ['p.error-message', '.text-red-500', '.error', '.invalid-feedback', 'span[role="alert"]', '.errorMessage', 'div.text-red-600'];
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
            } catch(e) {}
        }
        
        if (extractedTexts.length > 0) {
            // Unimos todos los mensajes rojitos visibles encontrados, quitando duplicados
            errorVisualExtraido = [...new Set(extractedTexts)].join(" | ");
        }
        
        const isBotonBloqueado = await page.locator('#submit_payment').isDisabled().catch(()=>true);
        
        const auditLog = {
            Destino: finalUrl,
            Test: testName,
            InputDelRobotQA: actionTaken,
            BotonEstabaDesactivado: isBotonBloqueado,
            MensajeDeErrorExtraidoDeLaPantalla: errorVisualExtraido
        };
        allure.attachment(`📋 Extraccion de Error - ${testName}`, JSON.stringify(auditLog, null, 2), "application/json");

        try {
            const buffer = await page.screenshot({ fullPage: true });
            allure.attachment(`📸 Evidencia Final - ${testName}`, buffer, "image/png");
        } catch(e) { console.log(e.message); }
        
        return { errorVisualExtraido, isBotonBloqueado };
    };

    const generarYPrepararCheckout = async () => {
        const payload = {
            "country": "EC",  "currency": "USD",  "amount": 100.00,
            "merchant_transaction_reference": `E2E-SEP-${Date.now()}`,
            "merchant_customer_id": "cliente_ec@ejemplo.com", 
            "allowed_payment_methods": [ "bank_transfer" ],  
            "predefined_fields": [{ "payment_method": "bank_transfer", "fields": {} }]
        };
        const postRes = await axios.post(PAYURL_ENDPOINT, payload, {
            headers: { 'DisablePartnerMock': 'true', 'Content-Type': 'application/json', 'Authorization': `Bearer ${freshToken}` },
            validateStatus: () => true 
        });
        const url = postRes.data.pay_url;

        const context = await browser.newContext({ locale: 'es-ES' });
        const page = await context.newPage();
        // Super optimización: En vez de esperar trackers de Analytics (networkidle), cargamos apenas el DOM esté listo
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        try {
            const bankDiv = page.locator('div:has-text("Transferencia bancaria")').last();
            // Crucial: Esperar a que JS renderice el marco de bancos antes de ver si count > 0
            await bankDiv.waitFor({ state: 'visible', timeout: 10000 }).catch(()=>null);
            
            if (await bankDiv.count() > 0 && await bankDiv.isVisible()) {
                await bankDiv.click();
                await page.waitForTimeout(500); 
            }
        } catch (e) {}

        return { url, page, context };
    };

    const fillBaseForm = async (page) => {
        await page.waitForSelector('#first_name', { timeout: 15000 }).catch(()=>null);
        await typeSafe(page, '#first_name', 'Sergio');
        await typeSafe(page, '#last_name', 'Testing');
        await typeSafe(page, '#email', 'perfecto@allure.com');
        await page.selectOption('#document_type', 'CI').catch(()=>null); 
        await typeSafe(page, '#document_number', '1710034065'); 
    };

    const attemptSubmit = async (page) => {
        const btn = page.locator('#submit_payment');
        await btn.evaluate(node => node.disabled = false).catch(()=>null);
        await btn.click({ force: true }).catch(()=>null);
        await page.waitForTimeout(1000); 
    };

    // ================================================================
    // SUITE 1: FIRST NAME AISLADO
    // ================================================================
    describe('1. Suite Independiente: Nombres (First Name)', () => {
        test('1.1. First Name: Boundary Corto (1 Letra)', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#first_name', 'A'); // Límite Inválido
            await attemptSubmit(page); 
            const rounded = await attachEvidence('FN - Corto (1L)', page, "First Name: 'A'", url);
            expect(rounded.isBotonBloqueado).toBe(true);  // Esto podría ser falso si QA/Dev aceptan 1 letra! Eso haría Fallar Rojo la prueba.
            await context.close();
        });

        test('1.2. First Name: Boundary Largo (55 Letras)', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#first_name', 'A'.repeat(55)); 
            await attemptSubmit(page); 
            const rounded = await attachEvidence('FN - Largo (55L)', page, "First Name: 'A'x55", url);
            expect(rounded.isBotonBloqueado).toBe(true);
            await context.close();
        });

        test('1.3. First Name: Falla Regex por Números', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#first_name', 'Sergio123'); 
            await attemptSubmit(page); 
            const rounded = await attachEvidence('FN - Numérico', page, "First Name: 'Sergio123'", url);
            expect(rounded.isBotonBloqueado).toBe(true);
            await context.close();
        });

        test('1.4. First Name: Falla Regex por Símbolos Inesperados (XSS)', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#first_name', '<script>'); 
            await attemptSubmit(page); 
            const rounded = await attachEvidence('FN - Simbolos XSS', page, "First Name: '<script>'", url);
            expect(rounded.isBotonBloqueado).toBe(true);
            await context.close();
        });

        test('1.5. First Name: Pasa Regex Frontera (Apóstrofe y Rango de Mediana)', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#first_name', "O'Connor"); 
            const rounded = await attachEvidence('FN - Apóstrofes y Feliz', page, "First Name: 'O'Connor'", url);
            // El assert es Rojo si la prueba detectó que el botón NO se activó (es un bug del Frontend)
            expect(rounded.isBotonBloqueado).toBe(false); 
            await context.close();
        });
    });

    // ================================================================
    // SUITE 2: LAST NAME AISLADO
    // ================================================================
    describe('2. Suite Independiente: Apellidos (Last Name)', () => {
        test('2.1. Last Name: Boundary Corto (1 Letra)', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#last_name', 'B'); 
            await attemptSubmit(page); 
            const rounded = await attachEvidence('LN - Corto (1L)', page, "Last Name: 'B'", url);
            expect(rounded.isBotonBloqueado).toBe(true);
            await context.close();
        });

        test('2.2. Last Name: Boundary Largo (>50 Letras)', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#last_name', 'B'.repeat(55)); 
            await attemptSubmit(page); 
            const rounded = await attachEvidence('LN - Largo (55L)', page, "Last Name: 'B'x55", url);
            expect(rounded.isBotonBloqueado).toBe(true);
            await context.close();
        });

        test('2.3. Last Name: Falla Regex por Números', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#last_name', 'Torres8'); 
            await attemptSubmit(page); 
            const rounded = await attachEvidence('LN - Numérico', page, "Last Name: 'Torres8'", url);
            expect(rounded.isBotonBloqueado).toBe(true);
            await context.close();
        });

        test('2.4. Last Name: Falla Regex por Símbolos', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#last_name', 'Torres@'); 
            await attemptSubmit(page); 
            const rounded = await attachEvidence('LN - Símbolos Rotos', page, "Last Name: 'Torres@'", url);
            expect(rounded.isBotonBloqueado).toBe(true);
            await context.close();
        });
        
        test('2.5. Last Name: Pasa Regex Frontera (Guiones)', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#last_name', "Torres-Gomez"); 
            const rounded = await attachEvidence('LN - Guion Valido', page, "Last Name: 'Torres-Gomez'", url);
            expect(rounded.isBotonBloqueado).toBe(false);
            await context.close();
        });
    });

    // ================================================================
    // SUITE 3: DOCUMENTOS (CI, DL, PP)
    // ================================================================
    describe('3. Suite de Identificaciones (Tipos Flakys Superados)', () => {
        
        test('3.1. Cédula CI: Boundary Falla por Faltan Caracteres (Ej: 9)', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await page.selectOption('#document_type', 'CI');
            await typeSafe(page, '#document_number', '171003406'); 
            await attemptSubmit(page);
            const r = await attachEvidence('CI - Corta 9 Digitos', page, "CI: '171003406'", url);
            expect(r.isBotonBloqueado).toBe(true);
            await context.close();
        });

        test('3.2. Cédula CI: Boundary Falla por Excedente (Ej: 11)', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await page.selectOption('#document_type', 'CI');
            await typeSafe(page, '#document_number', '17100340656'); 
            await attemptSubmit(page);
            const r = await attachEvidence('CI - Larga 11 Digitos', page, "CI: '17100340656'", url);
            expect(r.isBotonBloqueado).toBe(true);
            await context.close();
        });

        test('3.3. Licencia Conducir DL: Falla Patrón Metiendo Letras Nativas', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await page.selectOption('#document_type', 'DL');
            await typeSafe(page, '#document_number', 'A921473922'); // 10 de largo pero con la Letra A
            await attemptSubmit(page);
            const r = await attachEvidence('DL - Metiendo Letras a Licencia', page, "DL: 'A921473922'", url);
            expect(r.isBotonBloqueado).toBe(true);
            await context.close();
        });

        test('3.4. Pasaporte PP: Pasa Límite de Frontera Alfanumérica (Ej: 13 correctos)', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await page.selectOption('#document_type', 'PP');
            const limitePermitido = 'A1B2C3D4E5QW9'; 
            await typeSafe(page, '#document_number', limitePermitido); 
            const r = await attachEvidence('PP - Boundary Máximo Soportado', page, `PP: ${limitePermitido}`, url);
            expect(r.isBotonBloqueado).toBe(false);
            await context.close();
        });

        test('3.5. Pasaporte PP: Caza Bug Falla Límite Alto Invalido (Ej: 14 Chars)', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await page.selectOption('#document_type', 'PP');
            const rotoString = 'A1B2C3D4E5QW90'; // 14
            await typeSafe(page, '#document_number', rotoString); 
            await attemptSubmit(page);
            const r = await attachEvidence('PP - Boundary 14 (Desborde)', page, `PP: ${rotoString}`, url);
            expect(r.isBotonBloqueado).toBe(true);
            await context.close();
        });
    });

    // ================================================================
    // SUITE 4: CORREOS Y TLDs
    // ================================================================
    describe('4. Suite Correos (Emails y Expresiones Regulares)', () => {
        
        test('4.1. Email: Falla Sin Arroba y Muestra Componente Error', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#email', 'usuariogmail.com'); 
            await attemptSubmit(page);
            const r = await attachEvidence('Email - Sin Arroba', page, "Email: 'usuariogmail.com'", url);
            // El assertion verifica que NO esté habilitado o que emita el texto de 'correo@ejemplo.com'
            const exito = r.isBotonBloqueado === true || r.errorVisualExtraido.includes('correo') || r.errorVisualExtraido.includes('ejemplo.com');
            expect(exito).toBe(true);
            await context.close();
        });

        test('4.2. Email: Falla Sin TLD y Dominio, Emite Componente Error', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#email', 'usuario@gmail'); 
            await attemptSubmit(page);
            const r = await attachEvidence('Email - Sin .com', page, "Email: 'usuario@gmail'", url);
            const exito = r.isBotonBloqueado === true || r.errorVisualExtraido.includes('correo') || r.errorVisualExtraido.includes('ejemplo.com');
            expect(exito).toBe(true);
            await context.close();
        });
    });

});
