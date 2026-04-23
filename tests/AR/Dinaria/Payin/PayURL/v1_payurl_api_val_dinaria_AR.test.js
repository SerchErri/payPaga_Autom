// tests/AR/Dinaria/Payin/PayURL/v1_payurl_api_val_dinaria_AR.test.js
const axios = require('axios');
const allure = require('allure-js-commons');
const { chromium } = require('playwright');
const envConfig = require('../../../../../utils/envConfig');
const { getAccessToken } = require('../../../../../utils/authHelper');

const PAYURL_ENDPOINT = `${envConfig.BASE_URL}/payurl`;

jest.setTimeout(180000); 

describe(`[PayURL Dinaria AR] V1 Validación Backend Estricta y UI [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    
    let freshToken = '';
    let browser;
    let context;
    let page;

    beforeAll(async () => {
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
        const config = {
            headers: {
                'DisablePartnerMock': 'true',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${freshToken}`
            },
            validateStatus: () => true
        };

        const postRes = await axios.post(PAYURL_ENDPOINT, payload, config);
        
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
        } catch(e) {}
        return pageContent;
    };

    // ==========================================
    // BLOQUE 1: SEGURIDAD, MASIFICACIÓN Y AUTENTICACIÓN API
    // ==========================================
    describe('1. Seguridad e Integridad de la Llamada PayUrl', () => {
        test('1.1. Seguridad: Token Falso Rechazado (401)', async () => {
            const p = generateBasePayload();
            const response = await axios.post(PAYURL_ENDPOINT, p, {
                headers: { 'DisablePartnerMock': 'true', 'Content-Type': 'application/json', 'Authorization': `Bearer eyR.FAKE.TOKEN` },
                validateStatus: () => true
            });
            expect(response.status).toBe(401);
        });

        test('1.2. Integridad JSON: Bad Request (400) por string roto', async () => {
            const malformedPayload = `{ "country_code": "AR", "currency": "ARS", "transaction_total": 100 `;
            const response = await executePayUrlPost('JSON Malformado', malformedPayload, true);
            expect([400, 422]).toContain(response.status);
        });
    });

    // ==========================================
    // BLOQUE 2: RESTRICCIONES DE MONTOS Y MONEDAS
    // ==========================================
    describe('2. Root y Consistency (Amount Test Combinados)', () => {

        test('2.1. Amount: Límite Mínimo (Valor 0) - Validación UI (TC01)', async () => {
            const p = generateBasePayload(); p.transaction_total = 0;
            const res = await executePayUrlPost('Amount 0', p);
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

        test('2.1.1. TC02 Amount: Negative Amount Absolute Value Logic', async () => {
            const p = generateBasePayload(); p.transaction_total = -1500.00;
            const res = await executePayUrlPost('Negative Amount', p);
            let content = JSON.stringify(res.data);
            if (res.status === 200 || res.status === 201) {
                const checkoutUrl = res.data?.url || res.data?.pay_url || res.data?.redirect_url;
                content = await visitCheckoutAndForceValidation('Negative Amount', checkoutUrl);
            }
            const fueFrenado = /mayor que|greater than|invalid|incorrect|positive|not supported/i.test(content) || (!content.includes('1500.00') && !content.includes('Referencia de Pago'));
            expect(fueFrenado).toBe(true);
        });

        test('2.1.2. TC04 Amount: Null Amount Validation', async () => {
            const p = generateBasePayload(); p.transaction_total = null;
            const res = await executePayUrlPost('Null Amount', p);
            let content = JSON.stringify(res.data);
            if (res.status === 200 || res.status === 201) {
                const checkoutUrl = res.data?.url || res.data?.pay_url || res.data?.redirect_url;
                content = await visitCheckoutAndForceValidation('Null Amount', checkoutUrl);
            }
            const fueFrenado = /monto|amount|requerido|required|invalid|transaction_total/i.test(content);
            expect(fueFrenado).toBe(true);
        });

        test('2.1.3. TC05 Currency: Unsupported Currency Validation', async () => {
            const p = generateBasePayload(); p.currency = "USD";
            const res = await executePayUrlPost('Unsupported Currency', p);
            let content = JSON.stringify(res.data);
            if (res.status === 200 || res.status === 201) {
                const checkoutUrl = res.data?.url || res.data?.pay_url || res.data?.redirect_url;
                content = await visitCheckoutAndForceValidation('Unsupported Currency', checkoutUrl);
            }
            const fueFrenado = /currency|moneda|soport|support|invalid|required/i.test(content);
            expect(fueFrenado).toBe(true);
        });

        test('2.2. Amount: Validar importe puntual de 1.00 (Voucher Generado Ok)', async () => {
            const p = generateBasePayload(); p.transaction_total = 1.00;
            const res = await executePayUrlPost('Amount 1.00', p);
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

        test('2.3. Amount: Validar importe puntual de 10.21 (Voucher Generado Ok)', async () => {
            const p = generateBasePayload(); p.transaction_total = 10.21;
            const res = await executePayUrlPost('Amount 10.21', p);
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

        test('2.4. Amount: Exceso de 3 Decimales (10.005) - Falla en Backend 400', async () => {
            const p = generateBasePayload(); p.transaction_total = 10.005;
            const res = await executePayUrlPost('Amount 3 Decimales', p);
            
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
        test('3.1. First Name: Nulo', async () => {
            const content = await runFirstNameTest('First Name Nulo', null);
            expect(content).toContain('is required');
        });
        test('3.2. First Name: Vacío', async () => {
            const content = await runFirstNameTest('First Name Vacio', "");
            expect(content).toContain('is required');
        });
        test('3.3. First Name: Incluye Números', async () => {
            const content = await runFirstNameTest('First Name Números', "Sergio123");
            expect(content).toContain('input does not match the required format');
        });
        test('3.4. First Name: XSS HTML', async () => {
            const content = await runFirstNameTest('First Name HTML Injection', "<script>alert(1)</script> Sergio");
            expect(content).toContain('input does not match the required format');
        });
        test('3.5. First Name: Límite Estricto (51 Chars) (TC12)', async () => {
            const content = await runFirstNameTest('First Name Límite 51', "A".repeat(51));
            expect(content).toContain('length must be at most 50 characters');
        });
        test('3.5.1. First Name: Whitespace Only (TC08)', async () => {
            const content = await runFirstNameTest('First Name Solo Espacios', "     ");
            expect(content).toMatch(/required|format|invalid/i);
        });
        test('3.5.2. First Name: Special Characters (TC10)', async () => {
            const content = await runFirstNameTest('First Name Especiales', "Jon@Snow#");
            expect(content).toContain('input does not match the required format');
        });
        test('3.5.3. First Name: Single Character (TC11)', async () => {
            const content = await runFirstNameTest('First Name 1 Letra', "A");
            const esErrorString = /least 2|al menos 2|format|formato|requerid|invalid/i.test(content);
            expect(esErrorString).toBe(true);
        });
        test('3.5.4. First Name: Exact 50 Characters (TC13)', async () => {
            const content = await runFirstNameTest('First Name 50 Chars Feliz', "A".repeat(50));
            expect(content).toMatch(/Referencia de Pago/i);
        });

        // --- LAST NAME ---
        test('3.6. Last Name: Nulo', async () => {
            const content = await runLastNameTest('Last Name Nulo', null);
            expect(content).toContain('is required');
        });
        test('3.7. Last Name: Vacío', async () => {
            const content = await runLastNameTest('Last Name Vacio', "");
            expect(content).toContain('is required');
        });
        test('3.8. Last Name: Incluye Números', async () => {
            const content = await runLastNameTest('Last Name Numeros', "Gomez123");
            expect(content).toContain('input does not match the required format');
        });
        test('3.9. Last Name: XSS HTML', async () => {
            const content = await runLastNameTest('Last Name HTML Injection', "<script>alert(2)</script> Gomez");
            expect(content).toContain('input does not match the required format');
        });
        test('3.10. Last Name: Boundary 51 Chars (TC20)', async () => {
            const content = await runLastNameTest('Last Name Límite 51', "A".repeat(51));
            expect(content).toContain('length must be at most 50 characters');
        });
        test('3.10.1. Last Name: Whitespace Only (TC16)', async () => {
            const content = await runLastNameTest('Last Name Solo Espacios', "     ");
            expect(content).toMatch(/required|format|invalid/i);
        });
        test('3.10.2. Last Name: Special Characters (TC18)', async () => {
            const content = await runLastNameTest('Last Name Especiales', "Gomez%_!");
            expect(content).toContain('input does not match the required format');
        });
        test('3.10.3. Last Name: Single Character (TC19)', async () => {
            const content = await runLastNameTest('Last Name 1 Letra', "G");
            const esErrorString = /least 2|al menos 2|format|formato|requerid|invalid/i.test(content);
            expect(esErrorString).toBe(true);
        });
        test('3.10.4. Last Name: Exact 50 Characters (TC21)', async () => {
            const content = await runLastNameTest('Last Name 50 Chars Feliz', "B".repeat(50));
            expect(content).toMatch(/Referencia de Pago/i);
        });

        // --- DOCUMENT (CUIL AR) ---
        test('3.11. CUIL Inválido: Prefix Invalido (19...)', async () => {
            const content = await runDocTest('CUIL Prefix 19', "19123456789");
            expect(content).toContain('input does not match the required format');
        });
        test('3.12. CUIL Inválido: Corto (10 digitos)', async () => {
            const content = await runDocTest('CUIL Corto 10', "2012345678");
            expect(content).toContain('input does not match the required format');
        });
        
        test('3.13. CUIL Válido sin guiones (Voucher Exitoso) (TC25)', async () => {
            const content = await runDocTest('CUIL sin guiones Válido', "20084908488");
            expect(content).toMatch(/Referencia de Pago/i);
            expect(content).toMatch(/CVU|CBU/i);
        });

        test('3.13.1. CUIL Válido CON guiones (Voucher Exitoso) (TC24)', async () => {
            const content = await runDocTest('CUIL con guiones', "20-08490848-8");
            expect(content).toMatch(/Referencia de Pago/i);
            expect(content).toMatch(/CVU|CBU/i);
        });

        test('3.14. CUIL Inválido: Caracteres Especiales (TC26)', async () => {
            const content = await runDocTest('CUIL Especiales', "20-08490848-$");
            expect(content).toContain('input does not match the required format');
        });
        test('3.15. CUIL Inválido: Dígito Verificador Roto', async () => {
            const content = await runDocTest('CUIL Digito Roto', "20-08490848-9");
            expect(content).toContain('invalid cuil/cuit');
        });
        test('3.16. CUIL Inválido: Puntos (TC28)', async () => {
            const content = await runDocTest('CUIL Puntos', "20.08490848.8");
            expect(content).toContain('input does not match the required format');
        });

        // --- PAYMENT METHODS ---
        test('3.17. Payment Method: Empty (TC29)', async () => {
            const p = generateBasePayload();
            p.payment_method_data[0].payment_method_code = ""; 
            const res = await executePayUrlPost('Empty Pay Method', p);
            let content = JSON.stringify(res.data);
            if (res.status === 200 || res.status === 201) {
                const checkoutUrl = res.data?.url || res.data?.pay_url || res.data?.redirect_url;
                content = await visitCheckoutAndForceValidation('Empty Pay Method', checkoutUrl);
            }
            const esErrorString = /method|método|requerido|required|invalid|soporta|VALIDATION_ERROR/i.test(content);
            expect(esErrorString).toBe(true);
        });
        test('3.18. Payment Method: Incorrect (TC30)', async () => {
            const p = generateBasePayload();
            p.payment_method_data[0].payment_method_code = "crypto_bitcoin"; 
            p.payment_method_codes = ["crypto_bitcoin"];
            const res = await executePayUrlPost('Incorrect Pay Method', p);
            let content = JSON.stringify(res.data);
            if (res.status === 200 || res.status === 201) {
                const checkoutUrl = res.data?.url || res.data?.pay_url || res.data?.redirect_url;
                content = await visitCheckoutAndForceValidation('Incorrect Pay Method', checkoutUrl);
            }
            const esErrorString = /method|método|requerido|required|invalid|soporta|VALIDATION_ERROR|does not exist/i.test(content);
            expect(esErrorString).toBe(true);
        });
    });
});
