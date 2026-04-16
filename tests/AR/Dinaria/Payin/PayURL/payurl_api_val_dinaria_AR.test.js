const axios = require('axios');
const allure = require('allure-js-commons');
const { chromium } = require('playwright');
const envConfig = require('../../../../../utils/envConfig');
const { getAccessToken } = require('../../../../../utils/authHelper');

const PAYURL_ENDPOINT = `${envConfig.BASE_URL}/v2/pay-urls`;

jest.setTimeout(180000); 

describe(`[PayURL Dinaria AR] Validación Backend Estricta y UI [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    
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
        "country": "AR",
        "currency": "ARS",
        "amount": 1000.00,
        "merchant_transaction_reference": `PayUrlVal-AR-${Date.now()}`,
        "merchant_customer_id": "cliente_ar@ejemplo.com",
        "allowed_payment_methods": ["cvu"],
        "allowOverUnder": true,
        "predefined_fields": [
            {
                "payment_method": "cvu",
                "fields": {
                    "first_name": "Sergio",
                    "last_name": "Test",
                    "document_number": "20-08490848-8"
                }
            }
        ]
    });

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
            const malformedPayload = `{ "country": "AR", "currency": "ARS", "amount": 100 `;
            const response = await executePayUrlPost('JSON Malformado', malformedPayload, true);
            expect([400, 422]).toContain(response.status);
        });
    });

    // ==========================================
    // BLOQUE 2: RESTRICCIONES DE MONTOS Y MONEDAS
    // ==========================================
    describe('2. Root y Consistency (Amount Test Combinados)', () => {

        test('2.1. Amount: Límite Mínimo (Valor 0) - Validación UI', async () => {
            const p = generateBasePayload(); p.amount = 0;
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

        test('2.2. Amount: Validar importe puntual de 1.00 (Voucher Generado Ok)', async () => {
            const p = generateBasePayload(); p.amount = 1.00;
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
            const p = generateBasePayload(); p.amount = 10.21;
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
            const p = generateBasePayload(); p.amount = 10.005;
            const res = await executePayUrlPost('Amount 3 Decimales', p);
            
            expect(res.status).toBe(400); 
            expect(res.data.error.code).toBe("VALIDATION_ERROR");
            expect(res.data.error.details[0].message).toContain("currency ARS supports up to 2 decimals");
        });
    });

    // ==========================================
    // BLOQUE 3: CAMPOS DE IDENTIDAD (MISSING/INVALID FIELDS)
    // ==========================================
    describe('3. Campos de Identidad (First/Last/Docs) Validaciones de UI Mapeadas', () => {

        const runDocTest = async (testName, val) => {
            const p = generateBasePayload();
            p.predefined_fields[0].fields.document_number = val;
            const res = await executePayUrlPost(testName, p);
            const checkoutUrl = res.data?.url || res.data?.pay_url || res.data?.redirect_url;
            return await visitCheckoutAndForceValidation(testName, checkoutUrl);
        };

        const runFirstNameTest = async (testName, val) => {
            const p = generateBasePayload();
            p.predefined_fields[0].fields.first_name = val;
            const res = await executePayUrlPost(testName, p);
            const checkoutUrl = res.data?.url || res.data?.pay_url || res.data?.redirect_url;
            return await visitCheckoutAndForceValidation(testName, checkoutUrl);
        };

        const runLastNameTest = async (testName, val) => {
            const p = generateBasePayload();
            p.predefined_fields[0].fields.last_name = val;
            const res = await executePayUrlPost(testName, p);
            const checkoutUrl = res.data?.url || res.data?.pay_url || res.data?.redirect_url;
            return await visitCheckoutAndForceValidation(testName, checkoutUrl);
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
        test('3.5. First Name: Límite Estricto (51 Chars)', async () => {
            const content = await runFirstNameTest('First Name Límite 51', "A".repeat(51));
            expect(content).toContain('length must be at most 50 characters');
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
        test('3.10. Last Name: Boundary 51 Chars', async () => {
            const content = await runLastNameTest('Last Name Límite 51', "A".repeat(51));
            expect(content).toContain('length must be at most 50 characters');
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
        
        test('3.13. CUIL Válido sin guiones (Voucher Exitoso)', async () => {
            const content = await runDocTest('CUIL sin guiones Válido', "20084908488");
            expect(content).toMatch(/Referencia de Pago/i);
            expect(content).toMatch(/CVU|CBU/i);
        });

        test('3.14. CUIL Inválido: Caracteres Especiales', async () => {
            const content = await runDocTest('CUIL Especiales', "20-08490848-$");
            expect(content).toContain('input does not match the required format');
        });
        test('3.15. CUIL Inválido: Dígito Verificador Roto', async () => {
            const content = await runDocTest('CUIL Digito Roto', "20-08490848-9");
            expect(content).toContain('invalid cuil/cuit');
        });
        test('3.16. CUIL Inválido: Puntos', async () => {
            const content = await runDocTest('CUIL Puntos', "20.08490848.8");
            expect(content).toContain('input does not match the required format');
        });
    });
});
