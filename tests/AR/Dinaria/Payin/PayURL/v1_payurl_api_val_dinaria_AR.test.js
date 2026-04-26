// tests/AR/Dinaria/Payin/PayURL/v1_payurl_api_val_dinaria_AR.test.js
const axios = require('axios');
const allure = require('allure-js-commons');
const { chromium } = require('playwright');
const envConfig = require('../../../../../utils/envConfig');
const { getAccessToken } = require('../../../../../utils/authHelper');
const AuditLogger = require('../../../../../utils/auditLogger');

const PAYURL_ENDPOINT = `${envConfig.BASE_URL}/payurl`;

jest.setTimeout(180000); 

describe(`[PayURL Dinaria AR] V1 Validación Backend Estricta y UI [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    
    let freshToken = '';
    let browser;
    let context;
    let page;
    let auditLog;

    beforeAll(async () => {
        auditLog = new AuditLogger('V1_PayUrl_API_Val_AR');
        try { freshToken = await getAccessToken(); } catch (error) { console.error("Fallo obteniendo token global", error); }
        try {
            browser = await chromium.launch({ headless: true });
            context = await browser.newContext({ locale: 'es-ES', colorScheme: 'dark' });
            page = await context.newPage();
            page.setDefaultTimeout(30000);
        } catch (e) {
            console.error("Fallo levantando Playwright", e);
        }
    });

    afterAll(async () => {
        if (browser) await browser.close();
    });

    const generateBasePayload = () => ({
        "country_code": "AR",
        "currency": "ARS",
        "transaction_total": 1000.00,
        "merchant_transaction_reference": `PayUrlVal-AR-V1-${Date.now()}`,
        "payment_method_codes": ["cvu"],
        "payment_method_data": [
            {
                "payment_method_code": "cvu",
                "transaction_fields": [
                    { "name": "first_name", "value": "Sergio" },
                    { "name": "last_name", "value": "Test" },
                    { "name": "document_number", "value": "20-08490848-8" }
                ]
            }
        ]
    });

    const setTransactionField = (payload, name, value) => {
        const fields = payload.payment_method_data[0].transaction_fields;
        const field = fields.find(f => f.name === name);
        if (field) field.value = value;
        else fields.push({ name, value });
    };

    const executePayUrlPost = async (testName, payload, rawStringMode = false) => {
        auditLog.logTestStart(`[TEST] ${testName}`);
        
        const config = {
            headers: {
                'DisablePartnerMock': 'true',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${freshToken}`
            },
            validateStatus: () => true
        };

        const postRes = await axios.post(PAYURL_ENDPOINT, payload, config);
        
        const txId = postRes.data ? (postRes.data.transaction_id || postRes.data.id) : null;
        auditLog.logTest('API-V1-PAYURL-VAL', 'Negative / Boundary POST Execution', PAYURL_ENDPOINT, rawStringMode ? payload : JSON.stringify(payload), postRes.status, postRes.data, false, txId);
        
        if (allure && allure.attachment) {
            await allure.attachment(`Causa/Payload (Mandar al crear Link) - ${testName}`, rawStringMode ? payload : JSON.stringify(payload, null, 2), "application/json");
            await allure.attachment(`Efecto Backend API - ${testName}`, JSON.stringify({ status: postRes.status, body: postRes.data }, null, 2), "application/json");
        }

        console.log(`\n=== 🚨 RESULTADO PARA: ${testName} ===`);
        console.log(`Status Backend API (PayUrl): ${postRes.status}`);
        return postRes;
    };

    const visitCheckoutAndForceValidation = async (testName, checkoutUrl) => {
        if (!checkoutUrl) return "";
        console.log(`Visitando UI generada: ${checkoutUrl}`);
        let pageContent = "";
        try {
            await page.goto(checkoutUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2000);
            
            // Hacemos click en Pagar/Continuar para forzar los errores HTML5/React (En Identity Fields)
            const btnSubmit = page.locator('button[type="submit"], button:has-text("Continuar"), button:has-text("Pagar")').first();
            if (await btnSubmit.isVisible().catch(() => false)) {
                await btnSubmit.click({ force: true }).catch(() => null);
                await page.waitForTimeout(2000); 
            }
            
            pageContent = await page.innerText('body').catch(() => "");
            
            if (allure && allure.attachment) {
                const uiSnap = await page.screenshot({ fullPage: true }).catch(() => null);
                if (uiSnap) await allure.attachment(`📸 Evidencia UI: ${testName}`, uiSnap, "image/png");
            }
            
            // Log it in the Audit Logger to prove the Frontend Validation intercepted it
            if (pageContent) {
                const shortContent = pageContent.replace(/\s+/g, ' ').trim();
                const matchedError = shortContent.match(/El monto debe ser mayor que cero\.|is required|input does not match|length must be at most|al menos 2|invalid|does not exist/i) || ["(Voucher Generado Ok)"];
                auditLog.logFlow('UI Frontend Intercept Validation', { 
                    Context: testName, 
                    Action: 'Checkout Visited', 
                    Result: matchedError[0],
                    "[Voucher_View_Link]": checkoutUrl
                });
            }

        } catch(e) {}
        return pageContent;
    };

    // ==========================================
    // BLOQUE 1: SEGURIDAD, MASIFICACIÓN Y AUTENTICACIÓN API
    // ==========================================
    describe('1. Seguridad e Integridad de la Llamada PayUrl', () => {
        test('Seguridad: Token Falso Rechazado (401)', async () => {
            const p = generateBasePayload();
            
            auditLog.logTestStart(`[TEST] Seguridad: Token Falso Rechazado`);
            const response = await axios.post(PAYURL_ENDPOINT, p, {
                headers: { 'DisablePartnerMock': 'true', 'Content-Type': 'application/json', 'Authorization': `Bearer eyR.FAKE.TOKEN` },
                validateStatus: () => true
            });
            auditLog.logTest('API-V1-PAYURL-VAL', 'Negative / Boundary POST Execution', PAYURL_ENDPOINT, JSON.stringify(p), response.status, response.data, false, null);
            
            expect(response.status).toBe(401);
        });

        test('TC02 - Integridad JSON: Bad Request (400) por string roto', async () => {
            const malformedPayload = `{ "country_code": "AR", "currency": "ARS", "transaction_total": 100 `;
            const response = await executePayUrlPost('JSON Malformado', malformedPayload, true);
            expect([400, 422]).toContain(response.status);
        });
    });

    // ==========================================
    // BLOQUE 2: RESTRICCIONES DE MONTOS Y MONEDAS
    // ==========================================
    describe('2. Root y Consistency (Amount Test Combinados)', () => {

        test('TC01 - Amount: Límite Mínimo (Valor 0) - Validación UI', async () => {
            const p = generateBasePayload(); p.transaction_total = 0;
            const res = await executePayUrlPost('TC01 - Amount 0', p);
            expect([200, 201]).toContain(res.status);
            
            const checkoutUrl = res.data?.url || res.data?.pay_url || res.data?.redirect_url;
            await page.goto(checkoutUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2000);
            const content = await page.innerText('body').catch(()=>'');
            
            expect(content).toContain('El monto debe ser mayor que cero.');

            if (allure && allure.attachment) {
                const uiSnap = await page.screenshot({ fullPage: true }).catch(() => null);
                if (uiSnap) await allure.attachment(`📸 Evidencia Errores UI: Amount 0`, uiSnap, "image/png");
            }
        });

        test('TC02 - Amount: Negative Amount Absolute Value Logic', async () => {
            const p = generateBasePayload(); p.transaction_total = -1500.00;
            const res = await executePayUrlPost('TC02 - Negative Amount', p);
            let content = JSON.stringify(res.data);
            if (res.status === 200 || res.status === 201) {
                const checkoutUrl = res.data?.url || res.data?.pay_url || res.data?.redirect_url;
                content = await visitCheckoutAndForceValidation('TC02 - Negative Amount', checkoutUrl);
            }
            const fueFrenado = /mayor que|greater than|invalid|incorrect|positive|not supported/i.test(content) || (!content.includes('1500.00') && !content.includes('Referencia de Pago'));
            expect(fueFrenado).toBe(true);
        });

        test('TC03 - Amount: Null Amount Validation', async () => {
            const p = generateBasePayload(); p.transaction_total = null;
            const res = await executePayUrlPost('TC03 - Null Amount', p);
            let content = JSON.stringify(res.data);
            if (res.status === 200 || res.status === 201) {
                const checkoutUrl = res.data?.url || res.data?.pay_url || res.data?.redirect_url;
                content = await visitCheckoutAndForceValidation('TC03 - Null Amount', checkoutUrl);
            }
            const fueFrenado = /monto|amount|requerido|required|invalid|transaction_total/i.test(content);
            expect(fueFrenado).toBe(true);
        });

        test('TC04 - Currency: Unsupported Currency Validation', async () => {
            const p = generateBasePayload(); p.currency = "USD";
            const res = await executePayUrlPost('TC04 - Unsupported Currency', p);
            let content = JSON.stringify(res.data);
            if (res.status === 200 || res.status === 201) {
                const checkoutUrl = res.data?.url || res.data?.pay_url || res.data?.redirect_url;
                content = await visitCheckoutAndForceValidation('TC04 - Unsupported Currency', checkoutUrl);
            }
            const fueFrenado = /currency|moneda|soport|support|invalid|required/i.test(content);
            expect(fueFrenado).toBe(true);
        });

        test('TC05 - Amount: Validar importe puntual de 1.00 (Voucher Generado Ok)', async () => {
            const p = generateBasePayload(); p.transaction_total = 1.00;
            const res = await executePayUrlPost('TC05 - Amount 1.00', p);
            expect([200, 201]).toContain(res.status);

            const checkoutUrl = res.data?.url || res.data?.pay_url || res.data?.redirect_url;
            await page.goto(checkoutUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2500); 
            
            const btnSubmit = page.locator('button[type="submit"], button:has-text("Continuar")').first();
            if (await btnSubmit.isVisible().catch(() => false)) {
                await btnSubmit.click({ force: true });
                await page.waitForTimeout(4000); 
            }
            
            const content = await page.innerText('body').catch(()=>'');
            
            expect(content).toMatch(/1\.00|1,00/);
            expect(content).toContain('ARS');
            expect(content).toMatch(/Referencia de Pago/i);
            expect(content).toMatch(/CVU|CBU/i);
            
            if (allure && allure.attachment) {
                const uiSnap = await page.screenshot({ fullPage: true }).catch(() => null);
                if (uiSnap) await allure.attachment(`📸 Evidencia UI Voucher Generado (Amount 1.00)`, uiSnap, "image/png");
            }
        });

        test('TC06 - Amount: Validar importe puntual de 10.21 (Voucher Generado Ok)', async () => {
            const p = generateBasePayload(); p.transaction_total = 10.21;
            const res = await executePayUrlPost('TC06 - Amount 10.21', p);
            expect([200, 201]).toContain(res.status);

            const checkoutUrl = res.data?.url || res.data?.pay_url || res.data?.redirect_url;
            await page.goto(checkoutUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2500); 
            
            const btnSubmit = page.locator('button[type="submit"], button:has-text("Continuar")').first();
            if (await btnSubmit.isVisible().catch(() => false)) {
                await btnSubmit.click({ force: true });
                await page.waitForTimeout(4000); 
            }
            
            const content = await page.innerText('body').catch(()=>'');
            
            expect(content).toMatch(/10\.21|10,21/);
            expect(content).toContain('ARS');
            expect(content).toMatch(/Referencia de Pago/i);
            expect(content).toMatch(/CVU|CBU/i);
            
            if (allure && allure.attachment) {
                const uiSnap = await page.screenshot({ fullPage: true }).catch(() => null);
                if (uiSnap) await allure.attachment(`📸 Evidencia UI Voucher Generado (Amount 10.21)`, uiSnap, "image/png");
            }
        });

        test('TC07 - Amount: Exceso de 3 Decimales (10.005) - Falla en Backend 400', async () => {
            const p = generateBasePayload(); p.transaction_total = 10.005;
            const res = await executePayUrlPost('TC07 - Amount 3 Decimales', p);
            
            expect([400, 422]).toContain(res.status);
            const errorMsg = JSON.stringify(res.data).toLowerCase();
            expect(errorMsg).toMatch(/decimal|invalid|format|amount|transaction_total/);
        });
    });

    // ==========================================
    // BLOQUE 3: CAMPOS DE IDENTIDAD (MISSING/INVALID FIELDS)
    // ==========================================
    describe('3. Campos de Identidad (First/Last/Docs) Validaciones de UI Mapeadas', () => {

        const runDocTest = async (testName, val) => {
            const p = generateBasePayload();
            setTransactionField(p, "document_number", val);
            const res = await executePayUrlPost(testName, p);
            if (res.status === 200 || res.status === 201) {
                const checkoutUrl = res.data?.url || res.data?.pay_url || res.data?.redirect_url;
                return await visitCheckoutAndForceValidation(testName, checkoutUrl);
            }
            return JSON.stringify(res.data); // V1 bloqueó desde Backend. Devolvemos el JSON para validarlo.
        };

        const runFirstNameTest = async (testName, val) => {
            const p = generateBasePayload();
            setTransactionField(p, "first_name", val);
            const res = await executePayUrlPost(testName, p);
            if (res.status === 200 || res.status === 201) {
                const checkoutUrl = res.data?.url || res.data?.pay_url || res.data?.redirect_url;
                return await visitCheckoutAndForceValidation(testName, checkoutUrl);
            }
            return JSON.stringify(res.data);
        };

        const runLastNameTest = async (testName, val) => {
            const p = generateBasePayload();
            setTransactionField(p, "last_name", val);
            const res = await executePayUrlPost(testName, p);
            if (res.status === 200 || res.status === 201) {
                const checkoutUrl = res.data?.url || res.data?.pay_url || res.data?.redirect_url;
                return await visitCheckoutAndForceValidation(testName, checkoutUrl);
            }
            return JSON.stringify(res.data);
        };

        // --- FIRST NAME ---
        test('TC08 - First Name: Nulo', async () => {
            const content = await runFirstNameTest('TC08 - First Name Nulo', null);
            expect(content).toContain('is required');
        });
        test('TC09 - First Name: Vacío', async () => {
            const content = await runFirstNameTest('TC09 - First Name Vacio', "");
            expect(content).toContain('is required');
        });
        test('TC10 - First Name: Incluye Números', async () => {
            const content = await runFirstNameTest('TC10 - First Name Números', "Sergio123");
            expect(content).toContain('input does not match the required format');
        });
        test('TC11 - First Name: XSS HTML', async () => {
            const content = await runFirstNameTest('TC11 - First Name HTML Injection', "<script>alert(1)</script> Sergio");
            expect(content).toContain('input does not match the required format');
        });
        test('TC12 - First Name: Límite Estricto (51 Chars)', async () => {
            const content = await runFirstNameTest('TC12 - First Name Límite 51', "A".repeat(51));
            expect(content).toContain('length must be at most 50 characters');
        });
        test('TC13 - First Name: Whitespace Only', async () => {
            const content = await runFirstNameTest('TC13 - First Name Solo Espacios', "     ");
            expect(content).toMatch(/required|format|invalid/i);
        });
        test('TC14 - First Name: Special Characters', async () => {
            const content = await runFirstNameTest('TC14 - First Name Especiales', "Jon@Snow#");
            expect(content).toContain('input does not match the required format');
        });
        test('TC15 - First Name: Single Character', async () => {
            const content = await runFirstNameTest('TC15 - First Name 1 Letra', "A");
            const esErrorString = /least 2|al menos 2|format|formato|requerid|invalid/i.test(content);
            expect(esErrorString).toBe(true);
        });
        test('TC16 - First Name: Exact 50 Characters', async () => {
            const content = await runFirstNameTest('TC16 - First Name 50 Chars Feliz', "A".repeat(50));
            expect(content).toMatch(/Referencia de Pago/i);
        });

        // --- LAST NAME ---
        test('TC17 - Last Name: Nulo', async () => {
            const content = await runLastNameTest('TC17 - Last Name Nulo', null);
            expect(content).toContain('is required');
        });
        test('TC18 - Last Name: Vacío', async () => {
            const content = await runLastNameTest('TC18 - Last Name Vacio', "");
            expect(content).toContain('is required');
        });
        test('TC19 - Last Name: Incluye Números', async () => {
            const content = await runLastNameTest('TC19 - Last Name Numeros', "Gomez123");
            expect(content).toContain('input does not match the required format');
        });
        test('TC20 - Last Name: XSS HTML', async () => {
            const content = await runLastNameTest('TC20 - Last Name HTML Injection', "<script>alert(2)</script> Gomez");
            expect(content).toContain('input does not match the required format');
        });
        test('TC21 - Last Name: Boundary 51 Chars', async () => {
            const content = await runLastNameTest('TC21 - Last Name Límite 51', "A".repeat(51));
            expect(content).toContain('length must be at most 50 characters');
        });
        test('TC22 - Last Name: Whitespace Only', async () => {
            const content = await runLastNameTest('TC22 - Last Name Solo Espacios', "     ");
            expect(content).toMatch(/required|format|invalid/i);
        });
        test('TC23 - Last Name: Special Characters', async () => {
            const content = await runLastNameTest('TC23 - Last Name Especiales', "Gomez%_!");
            expect(content).toContain('input does not match the required format');
        });
        test('TC24 - Last Name: Single Character', async () => {
            const content = await runLastNameTest('TC24 - Last Name 1 Letra', "G");
            const esErrorString = /least 2|al menos 2|format|formato|requerid|invalid/i.test(content);
            expect(esErrorString).toBe(true);
        });
        test('TC25 - Last Name: Exact 50 Characters', async () => {
            const content = await runLastNameTest('TC25 - Last Name 50 Chars Feliz', "B".repeat(50));
            expect(content).toMatch(/Referencia de Pago/i);
        });

        // --- DOCUMENT (CUIL AR) ---
        test('TC26 - CUIL Inválido: Prefix Invalido (19...)', async () => {
            const content = await runDocTest('TC26 - CUIL Prefix 19', "19123456789");
            expect(content).toContain('input does not match the required format');
        });
        test('TC27 - CUIL Inválido: Corto (10 digitos)', async () => {
            const content = await runDocTest('TC27 - CUIL Corto 10', "2012345678");
            expect(content).toContain('input does not match the required format');
        });
        
        test('TC28 - CUIL Válido sin guiones (Voucher Exitoso)', async () => {
            const content = await runDocTest('TC28 - CUIL sin guiones Válido', "20084908488");
            expect(content).toMatch(/Referencia de Pago/i);
            expect(content).toMatch(/CVU|CBU/i);
        });

        test('TC29 - CUIL Válido CON guiones (Voucher Exitoso)', async () => {
            const content = await runDocTest('TC29 - CUIL con guiones', "20-08490848-8");
            expect(content).toMatch(/Referencia de Pago/i);
            expect(content).toMatch(/CVU|CBU/i);
        });

        test('TC30 - CUIL Inválido: Caracteres Especiales', async () => {
            const content = await runDocTest('TC30 - CUIL Especiales', "20-08490848-$");
            expect(content).toContain('input does not match the required format');
        });
        test('TC31 - CUIL Inválido: Dígito Verificador Roto', async () => {
            const content = await runDocTest('TC31 - CUIL Digito Roto', "20-08490848-9");
            expect(content).toContain('invalid cuil/cuit');
        });
        test('TC32 - CUIL Inválido: Puntos', async () => {
            const content = await runDocTest('TC32 - CUIL Puntos', "20.08490848.8");
            expect(content).toContain('input does not match the required format');
        });

        // --- PAYMENT METHODS ---
        test('TC33 - Payment Method: Empty', async () => {
            const p = generateBasePayload();
            p.payment_method_data[0].payment_method_code = ""; 
            const res = await executePayUrlPost('TC33 - Empty Pay Method', p);
            let content = JSON.stringify(res.data);
            if (res.status === 200 || res.status === 201) {
                const checkoutUrl = res.data?.url || res.data?.pay_url || res.data?.redirect_url;
                content = await visitCheckoutAndForceValidation('TC33 - Empty Pay Method', checkoutUrl);
            }
            const esErrorString = /method|método|requerido|required|invalid|soporta|VALIDATION_ERROR/i.test(content);
            expect(esErrorString).toBe(true);
        });
        test('TC34 - Payment Method: Incorrect', async () => {
            const p = generateBasePayload();
            p.payment_method_data[0].payment_method_code = "crypto_bitcoin"; 
            p.payment_method_codes = ["crypto_bitcoin"];
            const res = await executePayUrlPost('TC34 - Incorrect Pay Method', p);
            let content = JSON.stringify(res.data);
            if (res.status === 200 || res.status === 201) {
                const checkoutUrl = res.data?.url || res.data?.pay_url || res.data?.redirect_url;
                content = await visitCheckoutAndForceValidation('TC34 - Incorrect Pay Method', checkoutUrl);
            }
            const esErrorString = /method|método|requerido|required|invalid|soporta|VALIDATION_ERROR|does not exist/i.test(content);
            expect(esErrorString).toBe(true);
        });
    });
});
