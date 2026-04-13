const axios = require('axios');
const allure = require('allure-js-commons');
const { chromium } = require('playwright');
const envConfig = require('../../utils/envConfig');
const { getAccessToken } = require('../../utils/authHelper');

jest.setTimeout(1800000); // Ampliar timeout por la larga cola de peticiones

const casesData = [
    { country: 'AR', methods: ['cvu'] },
    { country: 'BR', methods: ['pix'] },
    { country: 'CL', methods: ['bank_transfer'] },
    { country: 'CO', methods: ['efecty', 'gana', 'pse', 'puntored', 'superpagos', 'susuerte', 'wu'] },
    { country: 'EC', methods: ['bemovil', 'minegocioefectivo', 'omniswitch', 'rapiactivo', 'wu'] },
    { country: 'SV', methods: ['puntoxpresssv'] },
    { country: 'GT', methods: ['bam'] },
    { country: 'MX', methods: ['paycash', 'spei'] },
    { country: 'PE', methods: ['bcp', 'bcp_efectivo', 'cellpower', 'globokas'] }
];

const flatCases = [];
casesData.forEach(c => {
    c.methods.forEach(m => {
        flatCases.push({ country: c.country, method: m });
    });
});

describe(`[E2E Híbrido API->UI] Generación de Vouchers masivos vía PayUrl`, () => {
    let token = '';
    let browser;
    let context;

    beforeAll(async () => {
        token = await getAccessToken();
        try {
            browser = await chromium.launch({ headless: true });
            context = await browser.newContext({ locale: 'es-ES', colorScheme: 'dark' });
        } catch (e) { console.error("Fallo levantando Playwright", e); }
    });

    afterAll(async () => {
        if (browser) await browser.close();
    });

    // Iteramos por cada país y método de pago
    test.each(flatCases)('Validar PayUrl API -> Voucher UI para País: $country | Método: $method', async ({ country, method }) => {
        console.log(`\n▶ INICIANDO TEST API PAYURL: País [${country}] Método [${method}]`);

        // ==============================================================================
        // 1. ASIGNACIÓN DE CURRENCY POR DEFECTO DEL PAÍS
        // ==============================================================================
        let currencyConfig = 'USD';
        if (country === 'AR') currencyConfig = 'ARS';
        if (country === 'BR') currencyConfig = 'BRL';
        if (country === 'CL') currencyConfig = 'CLP';
        if (country === 'CO') currencyConfig = 'COP';
        if (country === 'EC') currencyConfig = 'USD';
        if (country === 'GT') currencyConfig = 'GTQ';
        if (country === 'MX') currencyConfig = 'MXN';
        if (country === 'PE') currencyConfig = 'PEN';
        if (country === 'SV') currencyConfig = 'USD';

        // ==============================================================================
        // 2. CONSTRUCCIÓN DEL PAYLOAD REGIONAL `predefined_fields`
        // ==============================================================================
        let dynamicFields = {};

        if (country === 'AR') {
            dynamicFields = {
                first_name: "Sergio Daniel",
                last_name: "Gomez Peña",
                document_number: "20275105792"
            };
        }
        else if (country === 'BR') {
            dynamicFields = {
                first_name: "Thiago",
                last_name: "Dos Santos",
                document_number: "45832190865"
            };
        }
        else if (country === 'CL') {
            dynamicFields = {
                document_number: "14199075-6",
                email: "sergio.gomez@example.cl",
                bank_code: "santander"
            };
        }
        else if (country === 'CO') {
            if (method.includes('nequi')) {
                dynamicFields = { phone: "3001234567" };
            } else if (method.includes('pse')) {
                dynamicFields = {
                    first_name: "Mariana",
                    last_name: "Pajón",
                    document_type: "CC",
                    document_number: "52345678",
                    bank_code: "1007",
                    email: "mariana.test@pago.com.co",
                    phone: "3005551234",
                    address: "Carrera 7 # 71-21, Edificio Avant"
                };
            } else {
                // Fallback otros metodos colombia
                dynamicFields = {
                    first_name: "Radamel",
                    last_name: "Falcao",
                    document_number: "23456789",
                    email: "falcao.test@pago.com.co"
                };
            }
        }
        else if (country === 'EC') {
            dynamicFields = {
                first_name: "Luis",
                last_name: "Antonio Valencia",
                email: "l.valencia@test.com",
                document_type: "CI",
                document_number: method === 'bank_transfer' ? "1710034065" : "1712345678"
            };
        }
        else if (country === 'MX') {
            dynamicFields = {
                first_name: "Cuauhtémoc",
                last_name: "Blanco"
            };
            // Evitamos quemar el RFC de Spei en un Paycash por validación
            if (method.includes('spei')) {
                dynamicFields.document_number = "BLBC730117HDFLNR01";
            }
        }
        else if (country === 'PE') {
            dynamicFields = {
                phone: "981234567",
                conformation_code: "654321" // Respetando typos de validadores API (el usuario usa conformation_code)
            };
        }
        else if (country === 'GT') {
            dynamicFields = {
                first_name: "Ricardo",
                last_name: "Arjona",
                email: "r.arjona@gt.com"
            };
        }
        // Para SV el usuario indicó "no tiene datos para formulario..." 

        const myRefId = `PayUrl-${country}-${method}-${Date.now()}`;
        const payUrlEndpoint = `${envConfig.BASE_URL || 'https://api.v2.dev.paypaga.com'}/v2/pay-urls`;

        const validPayload = {
            "country": country,
            "currency": currencyConfig,
            "amount": (country === 'CL' || country === 'CO') ? 1155 : 1155.55, 
            "merchant_transaction_reference": myRefId,
            "merchant_customer_id": `automation_${country}@paypaga.com`,
            "allowed_payment_methods": [method], // Forzamos exclusivo este método
            "predefined_fields": [
                {
                    "payment_method": method,
                    "fields": dynamicFields
                }
            ]
        };

        if (allure && allure.attachment) {
            await allure.attachment(`Request API PayURL [${country} - ${method}]`, JSON.stringify(validPayload, null, 2), "application/json");
        }

        // ==============================================================================
        // 3. GENERAR EL ENLACE VIA API
        // ==============================================================================
        let response;
        try {
            response = await axios.post(payUrlEndpoint, validPayload, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'DisablePartnerMock': 'true' // Para que de link materializable y no caiga en dummy
                },
                validateStatus: () => true
            });
        } catch (error) {
            console.error(`Error de red llamando a API para ${country}/${method}`, error.message);
            throw error;
        }

        if (response.status !== 201) {
             const errorData = JSON.stringify(response.data, null, 2);
             if (allure && allure.attachment) await allure.attachment(`🔴 Error Carga API [${country} - ${method}]`, errorData, "application/json");
             throw new Error(`Fallo generando PayUrl vía API. Status: ${response.status}. Desc: ${errorData}`);
        }

        const checkoutUrl = response.data.url || response.data.pay_url || response.data.redirect_url;
        expect(checkoutUrl).toBeTruthy();

        console.log(`✔️ Link generado correctamente: ${checkoutUrl}`);

        // ==============================================================================
        // 4. ABRIR PLAYWRIGHT Y CAPTURAR VOUCHER DIRECTAMENTE
        // ==============================================================================
        const page = await context.newPage();
        page.setDefaultTimeout(30000);

        try {
            await page.goto(checkoutUrl, { waitUntil: 'load' });
            
            // Le damos tiempo al frontend de procesar el `predefined_fields` e intentar auto-submit el voucher
            await page.waitForTimeout(6000);

            // IMPORTANTE: Como los `predefined_fields` y el `allowed_payment_methods` (único) ya vienen dados, 
            // la UI de PayUrl podría haber pintado el comprobante final. Si se atora en algún botón tipo "Confirmar" 
            // sin autogenerarse, podríamos simular el click aquí. Pero validaremos cómo reacciona en primer lugar:
            
            // Si vemos un botón para continuar (ej. que la UI pida confirmarlo)
            const btnPagar = page.locator('button').filter({ hasText: /^Pagar|Continuar|Confirmar/i }).first();
            if (await btnPagar.isVisible()) {
                 console.log("➡️ Se requirió click manual en 'Confirmar/Pagar' en la UI.");
                 await btnPagar.click({ force: true });
                 await page.waitForTimeout(5000);
            }

            // Tomar Screenshot Final del Voucher (o error de UI si faltaban datos en form)
            if (allure && allure.attachment) {
                const ssVoucher = await page.screenshot({ fullPage: true });
                await allure.attachment(`📸 Evidencia Voucher (Render UI) - [${country}] ${method}`, ssVoucher, "image/png");
            }
        } catch (e) {
            console.error(`Error procesando checkout URL para ${country}: `, e.message);
            if (allure && allure.attachment) {
                const errSS = await page.screenshot({ fullPage: true });
                await allure.attachment(`🔴 Error rendering Checkout - [${country}] ${method}`, errSS, "image/png");
            }
            throw e;
        } finally {
            await page.close();
        }
    });
});
