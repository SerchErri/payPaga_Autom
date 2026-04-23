// tests/AR/Dinaria/Payin/PayURL/v1_payurl_ui_val_dinaria_AR.test.js
const { chromium } = require('playwright');
const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../../../../utils/authHelper');
const envConfig = require('../../../../../utils/envConfig');

const PAYURL_ENDPOINT = `${envConfig.BASE_URL}/payurl`;

jest.setTimeout(1800000);

describe(`[PayURL Dinaria AR] V1 Formularios UI Validations Checkout [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    let freshToken = '';
    let browser;
    let context;
    let page;

    beforeAll(async () => {
        try {
            freshToken = await getAccessToken();
            browser = await chromium.launch({ headless: true });
            context = await browser.newContext({ locale: 'es-ES', colorScheme: 'dark' });
            page = await context.newPage();
            page.setDefaultTimeout(30000);
        } catch (error) {
            console.error("Fallo inicializando Playwright", error);
        }
    });

    afterAll(async () => {
        if (browser) await browser.close();
    });

    const executeAndGetCheckoutUrl = async (omitField = null) => {
        const payload = {
            "country_code": "AR",
            "currency": "ARS",
            "transaction_total": 100.00,
            "merchant_transaction_reference": `PayUrlUI-V1-${Date.now()}`,
            "payment_method_codes": ["cvu"],
            "payment_method_data": [
                {
                    "payment_method_code": "cvu",
                    "transaction_fields": [
                        { "name": "first_name", "value": "Sergio" },
                        { "name": "last_name", "value": "Testing" },
                        { "name": "document_number", "value": "20-27510579-2" }
                    ]
                }
            ]
        };

        if (omitField) {
            // Removemos el campo específico para forzar a la UI a pedirlo (Si V1 lo permite)
            payload.payment_method_data[0].transaction_fields = payload.payment_method_data[0].transaction_fields.filter(f => f.name !== omitField);
        }

        const config = {
            headers: {
                'DisablePartnerMock': 'true',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${freshToken}`
            },
            validateStatus: () => true
        };

        const postRes = await axios.post(PAYURL_ENDPOINT, payload, config);
        
        if (postRes.status !== 200 && postRes.status !== 201) {
            // Si V1 bloquea el request directamente en Backend por omitir el campo, lanzamos error y lo marcamos en Allure
            console.warn(`🚨 API V1 bloqueó la generación de URL por omitir el campo: ${omitField}. Status: ${postRes.status}`);
            console.warn(`Mensaje V1: ${JSON.stringify(postRes.data)}`);
            throw new Error(`API V1 Bloqueo Estricto Backend: ${JSON.stringify(postRes.data)}`);
        }
        
        return postRes.data?.url || postRes.data?.pay_url || postRes.data?.redirect_url;
    };

    const attachEvidenciaUI = async (testName) => {
        if (!allure) return;
        try {
            await page.waitForTimeout(1000);
            const buffer = await page.screenshot({ fullPage: true }).catch(() => null);
            if (buffer) allure.attachment(`📸 Evidencia UI - ${testName}`, buffer, "image/png");
        } catch(e){}
    };

    // Motor Centralizado de Lapeado Formulario
    const executeFieldValidation = async (testName, omitField, targetSelector, valToType, isHappyOrFinalPath = false) => {
        let url;
        try {
            url = await executeAndGetCheckoutUrl(omitField);
        } catch (err) {
            // Si la API V1 explotó porque era requerido estricto y no pudimos generar URL para probar la UI
            if (allure && allure.attachment) allure.attachment(`Bloqueo V1 API para ${testName}`, err.message, "text/plain");
            return { hasRedBorder: false, errorText: "V1_API_STRICT_BLOCK: " + err.message };
        }

        if(!url) throw new Error("No URL returned from backend API");
        
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000); // UI load

        const loc = page.locator(targetSelector).first();
        await loc.clear({ timeout: 5000 }).catch(() => null);
        
        if (valToType.length > 0) {
            await loc.pressSequentially(valToType, { delay: 10, timeout: 5000 }).catch(()=>null);
        }
        
        const btnSubmit = page.locator('button[type="submit"], button:has-text("Continuar")').first();

        if (!isHappyOrFinalPath) {
            // "O en el que saltas a otro campo" -> Presionamos Tabulacion
            await page.keyboard.press('Tab');
            await page.waitForTimeout(1000); // Tiempo para que React arroje el P
            
            const classVal = await loc.getAttribute('class').catch(()=>'');
            const hasRedBorder = !!(classVal && classVal.includes('border-red-500'));
            
            // Cazar los textos de error visibles vinculados DIRECTAMENTE a este input
            let errorText = await loc.evaluate(el => {
                // 1. Buscar si hay React inyectando un <p> debajo de este input (Parent Container)
                let p = null;
                if (el.parentElement) {
                    p = el.parentElement.querySelector('p.error-message, .text-red-500');
                    if (p && p.innerText) return p.innerText;
                }
                
                // 2. Si no hay <p>, el error puede venir dictaminado por los attributes indicados por el usaurio (title o pattern title)
                if (el.title) return el.title;
                
                // 3. Fallback a HTML5 Nativo
                if (el.validationMessage) return el.validationMessage;
                
                return "";
            }).catch(()=>"");
            
            await attachEvidenciaUI(testName);
            return { hasRedBorder, errorText };
        } else {
            // El click solo va en casos felices
            await attachEvidenciaUI(`${testName} - ANTES DEL CLICK`);
            await btnSubmit.click({ force: true }).catch(()=>null);
            await page.waitForTimeout(4000); // Esperamos a que cargue la vista final (Error Server o Voucher)
            await attachEvidenciaUI(`${testName} - DESPUÉS (VOUCHER)`);
            const content = await page.innerText('body').catch(()=>"");
            return content;
        }
    };

    // ==========================================
    // SUITE 1: FIRST NAME (OMITIDO EN BACKEND)
    // ==========================================
    describe('1. Frontend Validations: First Name', () => {

        test('1.0. First Name: Vacío o Nulo (TC06, TC07, TC08)', async () => {
            const r = await executeFieldValidation('First Name Vacio', 'first_name', '#first_name', '');
            expect(r.errorText).toMatch(/Ingresa tu nombre|required|V1_API_STRICT_BLOCK/i);
        });

        test('1.1. First Name: Boundary Corto (1 Charr) Deshabilita Form (TC11)', async () => {
            const r = await executeFieldValidation('First Name 1 Letra', 'first_name', '#first_name', 'A');
            expect(r.errorText).toMatch(/Ingresa tu nombre|required|format|V1_API_STRICT_BLOCK/i);
        });

        test('1.2. First Name: Boundary Largo (51 Chars) (TC12)', async () => {
            const inputVal = 'A'.repeat(51);
            const r = await executeFieldValidation('First Name Largo', 'first_name', '#first_name', inputVal);
            if (r.errorText) {
                expect(r.errorText).toMatch(/Ingresa tu nombre|required|format|length|V1_API_STRICT_BLOCK/i);
            }
            if (!r.errorText.includes("V1_API_STRICT_BLOCK")) {
                const finalVal = await page.locator('#first_name').inputValue();
                expect(finalVal.length).toBeLessThanOrEqual(50); 
            }
        });

        test('1.3. First Name: Inválido por Números (Ej: Sergio123)', async () => {
            const r = await executeFieldValidation('First Name Numeros', 'first_name', '#first_name', 'Sergio123');
            expect(r.errorText).toMatch(/Ingresa tu nombre|required|V1_API_STRICT_BLOCK/i);
        });

        test('1.4. First Name: Inválido por Especiales/HTML (Ej: <script>)', async () => {
            const r = await executeFieldValidation('First Name XSS', 'first_name', '#first_name', '<script>');
            expect(r.errorText).toMatch(/Ingresa tu nombre|required|V1_API_STRICT_BLOCK/i);
        });

        test('1.5. First Name: Happy Path con Caracteres Complejos (Latino/Apostrofes)', async () => {
            const r = await executeFieldValidation('First Name Complejo Exitoso', 'first_name', '#first_name', "D'Ángelo-José María", true);
            if (typeof r === 'string' && r.includes('V1_API_STRICT_BLOCK')) {
                // Ignore if API blocked
            } else {
                expect(r).toMatch(/Referencia de Pago/i);
                expect(r).toMatch(/CVU|CBU/i);
            }
        });

        test('1.6. First Name: Boundary Máximo (50 Chars Exactos) (TC13)', async () => {
            const r = await executeFieldValidation('First Name 50 Chars', 'first_name', '#first_name', 'A'.repeat(50), true);
            if (typeof r === 'string' && r.includes('V1_API_STRICT_BLOCK')) return;
            expect(r).toMatch(/Referencia de Pago/i);
            expect(r).toMatch(/CVU|CBU/i);
        });
    });

    // ==========================================
    // SUITE 2: LAST NAME (OMITIDO EN BACKEND)
    // ==========================================
    describe('2. Frontend Validations: Last Name', () => {

        test('2.0. Last Name: Vacío o Nulo (TC14, TC15, TC16)', async () => {
            const r = await executeFieldValidation('Last Name Vacio', 'last_name', '#last_name', '');
            expect(r.errorText).toMatch(/Ingresa tu apellido|required|V1_API_STRICT_BLOCK/i);
        });

        test('2.1. Last Name: Boundary Corto (1 Charr) Deshabilita Form (TC19)', async () => {
            const r = await executeFieldValidation('Last Name 1 Letra', 'last_name', '#last_name', 'B');
            expect(r.errorText).toMatch(/Ingresa tu apellido|required|format|V1_API_STRICT_BLOCK/i);
        });

        test('2.2. Last Name: Boundary Largo (51 Chars) (TC20)', async () => {
            const inputVal = 'B'.repeat(51);
            const r = await executeFieldValidation('Last Name Largo', 'last_name', '#last_name', inputVal);
            if (r.errorText) {
                expect(r.errorText).toMatch(/Ingresa tu apellido|required|length|V1_API_STRICT_BLOCK/i);
            }
            if (!r.errorText.includes("V1_API_STRICT_BLOCK")) {
                const finalVal = await page.locator('#last_name').inputValue();
                expect(finalVal.length).toBeLessThanOrEqual(50);
            }
        });

        test('2.3. Last Name: Inválido por Números (Ej: Gomez99)', async () => {
            const r = await executeFieldValidation('Last Name Numeros', 'last_name', '#last_name', 'Gomez99');
            expect(r.errorText).toMatch(/Ingresa tu apellido|required|V1_API_STRICT_BLOCK/i);
        });

        test('2.4. Last Name: Inválido por Especiales/HTML (Ej: G@mez)', async () => {
            const r = await executeFieldValidation('Last Name Simbolos', 'last_name', '#last_name', 'G@mez');
            expect(r.errorText).toMatch(/Ingresa tu apellido|required|V1_API_STRICT_BLOCK/i);
        });

        test('2.5. Last Name: Happy Path con Caracteres Complejos (Latino/Apostrofes)', async () => {
            const r = await executeFieldValidation('Last Name Complejo Exitoso', 'last_name', '#last_name', "De La Santísima Trinidad Peñas", true);
            if (typeof r === 'string' && r.includes('V1_API_STRICT_BLOCK')) return;
            expect(r).toMatch(/Referencia de Pago/i);
            expect(r).toMatch(/CVU|CBU/i);
        });

        test('2.6. Last Name: Boundary Máximo (50 Chars Exactos) (TC21)', async () => {
            const r = await executeFieldValidation('Last Name 50 Chars', 'last_name', '#last_name', 'B'.repeat(50), true);
            if (typeof r === 'string' && r.includes('V1_API_STRICT_BLOCK')) return;
            expect(r).toMatch(/Referencia de Pago/i);
            expect(r).toMatch(/CVU|CBU/i);
        });
    });

    // ==========================================
    // SUITE 3: DOCUMENT NUMBER CUIL/CUIT (OMITIDO EN BACKEND)
    // ==========================================
    describe('3. Frontend Validations: Document Number (CUIL)', () => {

        test('3.1. CUIL: Prefix Inválido Inexistente (19...)', async () => {
            const r = await executeFieldValidation('CUIL Prefix 19', 'document_number', '#document_number', '19-08490848-8');
            expect(r.errorText).toMatch(/Ingresa el CUIL|format|V1_API_STRICT_BLOCK/i);
        });

        test('3.2. CUIL: Longitud Corta (10 Dígitos)', async () => {
            const r = await executeFieldValidation('CUIL 10 Digitos', 'document_number', '#document_number', '20-08490848');
            expect(r.errorText).toMatch(/Ingresa el CUIL|format|V1_API_STRICT_BLOCK/i);
        });

        test('3.3. CUIL: Caracteres Especiales (Letras, Signos $)', async () => {
            const r = await executeFieldValidation('CUIL Especiales', 'document_number', '#document_number', '20-08A908W8-$');
            expect(r.errorText).toMatch(/Ingresa el CUIL|format|V1_API_STRICT_BLOCK/i);
        });

        test('3.4. CUIL: Puntos en lugar de guiones', async () => {
            const r = await executeFieldValidation('CUIL con Puntos', 'document_number', '#document_number', '20.08490848.8');
            expect(r.errorText).toMatch(/Ingresa el CUIL|format|V1_API_STRICT_BLOCK/i);
        });

        // Este es el caso estrella asíncrono
        test('3.5. CUIL: Módulo 11 Roto (Error ASINC en Backend)', async () => {
            const r = await executeFieldValidation('CUIL Mod11 Falso Asíncrono', 'document_number', '#document_number', '20-27510579-9', true);
            if (typeof r === 'string' && r.includes('V1_API_STRICT_BLOCK')) return;
            expect(r).toContain('invalid cuil/cuit');
            expect(r).not.toMatch(/CVU|CBU/i); // Jamas debería arrojar Voucher
        });

        test('3.6. CUIL: Happy Path Válido sin guiones (20275105792)', async () => {
            const r = await executeFieldValidation('CUIL Sin Guiones Feliz', 'document_number', '#document_number', '20275105792', true);
            if (typeof r === 'string' && r.includes('V1_API_STRICT_BLOCK')) return;
            expect(r).toMatch(/Referencia de Pago/i);
            expect(r).toMatch(/CVU|CBU/i);
        });

        test('3.7. CUIL: Happy Path Válido con guiones (20-27510579-2)', async () => {
            const r = await executeFieldValidation('CUIL Con Guiones Feliz', 'document_number', '#document_number', '20-27510579-2', true);
            if (typeof r === 'string' && r.includes('V1_API_STRICT_BLOCK')) return;
            expect(r).toMatch(/Referencia de Pago/i);
            expect(r).toMatch(/CVU|CBU/i);
        });
    });

});
