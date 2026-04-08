const { chromium } = require('playwright');
const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../../utils/authHelper');
const envConfig = require('../../../utils/envConfig');

const PAYURL_ENDPOINT = `${envConfig.BASE_URL}/v2/pay-urls`;

jest.setTimeout(1800000);

describe(`[EC] [DoPayment] [Payin] [PayURL] [DEV] Validation Suite`, () => {
    
    let freshToken = '';
    let browser;

    beforeAll(async () => {
        try { 
            freshToken = await getAccessToken(); 
            browser = await chromium.launch({ headless: true }); 
        } catch (error) { 
            console.error("Fallo obteniendo token global o Chromium", error); 
        }
    });

    afterAll(async () => {
        if (browser) await browser.close();
    });

    const typeSafe = async (page, selector, textToType) => {
        try {
            const loc = page.locator(selector).first();
            await loc.clear({ timeout: 5000 }).catch(() => null);
            await loc.pressSequentially(textToType, { delay: 10, timeout: 5000 });
        } catch (e) {
            console.log(`Error tipográfico en ${selector}:`, e.message);
        }
    };

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
            errorVisualExtraido = [...new Set(extractedTexts)].join(" | ");
        }
        
        let isBotonBloqueado = false;
        if (page.url() === finalUrl) {
            isBotonBloqueado = await page.locator('#submit_payment').isDisabled().catch(()=>true);
        } else {
            // Si la URL cambió, significa que el checkout procesó y redirigió (Éxito Rotundo)
            isBotonBloqueado = false;
        }
        
        const auditLog = {
            Destino: finalUrl,
            Test: testName,
            InputDelRobotQA: actionTaken,
            BotonEstabaDesactivado: isBotonBloqueado,
            MensajeDeErrorExtraidoDeLaPantalla: errorVisualExtraido
        };
        allure.attachment(`📋 Extraccion - ${testName}`, JSON.stringify(auditLog, null, 2), "application/json");

        try {
            const buffer = await page.screenshot({ fullPage: true });
            allure.attachment(`📸 Evidencia Final - ${testName}`, buffer, "image/png");
        } catch(e) {}
        
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

        const context = await browser.newContext({ locale: 'es-ES', colorScheme: 'dark' });
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        try {
            const bankDiv = page.locator('div:has-text("Transferencia bancaria")').last();
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
        if (allure && allure.attachment) {
            try {
                await page.waitForTimeout(500);
                const buffer = await page.screenshot({ fullPage: true });
                allure.attachment(`📸 Formulario (Antes de Click)`, buffer, "image/png");
            } catch(e) {}
        }
        const btn = page.locator('#submit_payment');
        // Se hace clic de forma natural, sin forzar enablement
        await btn.click({ timeout: 1000 }).catch(()=>null);
        await page.waitForTimeout(1000); 
    };

    describe('1. Suite Independiente: Nombres (First Name)', () => {
        test('1.1. First Name: Boundary Corto (1 Letra)', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#first_name', 'A');
            await attemptSubmit(page); 
            const rounded = await attachEvidence('FN - Corto (1L)', page, "First Name: 'A'", url);
            expect(rounded.isBotonBloqueado).toBe(true);
            await context.close();
        });

        test('1.2. First Name: Boundary Largo (51 Letras) [Fallo]', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#first_name', 'A'.repeat(51)); 
            await attemptSubmit(page); 
            const rounded = await attachEvidence('FN - Largo Fallo (51L)', page, "First Name: 'A'x51", url);
            expect(rounded.isBotonBloqueado).toBe(true);
            await context.close();
        });

        test('1.2.1. First Name: Boundary Valido Máximo (50 Letras) [Éxito]', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#first_name', 'A'.repeat(50)); 
            // Sin hack `node.disabled = false`
            await page.locator('#submit_payment').click();
            await page.waitForTimeout(3000); 
            
            const rounded = await attachEvidence('FN - Limite 50 Exitoso', page, "First Name: 'A'x50", url);
            expect(rounded.isBotonBloqueado).toBe(false);
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

        test('1.5. First Name: Pasa Regex Frontera (Apóstrofe y Espacios Ñ) [Éxito]', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#first_name', "O'Connor ñÑ áéíóú"); 
            
            await page.locator('#submit_payment').click();
            await page.waitForTimeout(3000);

            const rounded = await attachEvidence('FN - Apóstrofes y Feliz', page, "First Name: 'O'Connor ñÑ áéíóú'", url);
            expect(rounded.isBotonBloqueado).toBe(false); 
            await context.close();
        });
    });

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

        test('2.2. Last Name: Boundary Largo (51 Letras) [Fallo]', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#last_name', 'B'.repeat(51)); 
            await attemptSubmit(page); 
            const rounded = await attachEvidence('LN - Largo Fallo (51L)', page, "Last Name: 'B'x51", url);
            expect(rounded.isBotonBloqueado).toBe(true);
            await context.close();
        });

        test('2.2.1. Last Name: Boundary Valido Máximo (50 Letras) [Éxito]', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#last_name', 'B'.repeat(50)); 
            // Sin hack `node.disabled = false`
            await page.locator('#submit_payment').click();
            await page.waitForTimeout(3000); 
            
            const rounded = await attachEvidence('LN - Limite 50 Exitoso', page, "Last Name: 'B'x50", url);
            expect(rounded.isBotonBloqueado).toBe(false);
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
        
        test('2.5. Last Name: Pasa Regex Frontera (Guiones y Espacios) [Éxito]', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#last_name', "Torres-Gomez ñÑ áéíóú"); 
            
            await page.locator('#submit_payment').click();
            await page.waitForTimeout(3000);

            const rounded = await attachEvidence('LN - Guion Valido', page, "Last Name: 'Torres-Gomez ñÑ áéíóú'", url);
            expect(rounded.isBotonBloqueado).toBe(false);
            await context.close();
        });
    });

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
            await typeSafe(page, '#document_number', 'A921473922'); 
            await attemptSubmit(page);
            const r = await attachEvidence('DL - Metiendo Letras a Licencia', page, "DL: 'A921473922'", url);
            expect(r.isBotonBloqueado).toBe(true);
            await context.close();
        });

        test('3.4. Pasaporte PP: Pasa Límite de Frontera Alfanumérica (<13 correctos) [Éxito]', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await page.selectOption('#document_type', 'PP');
            const limitePermitido = 'A1B2C3D4E5'; // Menos de 13 caracteres mixto
            await typeSafe(page, '#document_number', limitePermitido); 
            
            await page.locator('#submit_payment').click();
            await page.waitForTimeout(3000); 
            
            const r = await attachEvidence('PP - Exitoso Menos 13 Chars', page, `PP: ${limitePermitido}`, url);
            expect(r.isBotonBloqueado).toBe(false); 
            await context.close();
        });

        test('3.5. Pasaporte PP: Falla Límite Alto Invalido (>13 Chars) [Fallo]', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await page.selectOption('#document_type', 'PP');
            const rotoString = 'A1B2C3D4E5QW90Z'; // 15
            await typeSafe(page, '#document_number', rotoString); 
            await attemptSubmit(page);
            const r = await attachEvidence('PP - Boundary 15 (Desborde)', page, `PP: ${rotoString}`, url);
            // El boton debe bloquearse si hay error
            expect(r.isBotonBloqueado).toBe(true);
            await context.close();
        });
    });

    describe('4. Suite Correos (Emails y Expresiones Regulares)', () => {
        test('4.1. Email: Falla Sin Arroba y Muestra Componente Error', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#email', 'usuariogmail.com'); 
            await attemptSubmit(page);
            const r = await attachEvidence('Email - Sin Arroba Fallido', page, "Email: 'usuariogmail.com'", url);
            expect(r.isBotonBloqueado).toBe(true);
            await context.close();
        });

        test('4.2. Email: Falla Sin TLD y Dominio, Emite Componente Error', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#email', 'usuario@gmail'); 
            await attemptSubmit(page);
            const r = await attachEvidence('Email - Sin .com Fallido', page, "Email: 'usuario@gmail'", url);
            expect(r.isBotonBloqueado).toBe(true);
            await context.close();
        });
        
        test('4.3. Email: Patrón Válido Corto (Happy Path)', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#email', 'a@b.co'); 
            await page.locator('#submit_payment').click();
            await page.waitForTimeout(3000);
            const r = await attachEvidence('Email - Corto Valido Exito', page, "Email: 'a@b.co'", url);
            expect(r.isBotonBloqueado).toBe(false);
            await context.close();
        });
    });

});
