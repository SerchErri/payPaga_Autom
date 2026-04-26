const axios = require('axios');
const allure = require('allure-js-commons');
const { chromium } = require('playwright');
const envConfig = require('../../../../../utils/envConfig');
const { getAccessToken } = require('../../../../../utils/authHelper');
const AuditLogger = require('../../../../../utils/auditLogger');
const SandboxHelper = require('../../../../../utils/sandboxHelper');

jest.setTimeout(1800000); 

describe(`[Hybrid E2E] V1 PayUrl Omnichannel to API Flow Dinaria (AR) [Env: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    let token = '';
    let browser;
    let context;
    let page;
    let auditLog;
    
    const merchantId = envConfig.MERCHANT_ID || "370914c8-c42a-4309-b50c-45656ad50b7c";
    const SANDBOX_MERCHANT_1_TOKEN = 'di_sand_reg_paypaga_merch';
    const SANDBOX_MERCHANT_3_TOKEN = 'di_sand_c99ad6fbcf5332c02f8a0c486da534f668afc295';
    const DINARIA_SANDBOX_URL = 'https://api.sandbox.dinaria.com/ars/cashin/simulate';
    
    const getV1MerchantBalance = async (accessToken) => {
        const balRes = await axios.get(`${envConfig.BASE_URL}/get_merchant_balance?country_code=AR&payment_method=cvu`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (!balRes.data || !balRes.data.country_collection) return { general: 0, volume: 0, fees: 0, taxes: 0 };
        const countryCol = balRes.data.country_collection.find(c => c.country_code === 'AR');
        if(!countryCol) return { general: 0, volume: 0, fees: 0, taxes: 0 };
        const paymentCol = countryCol.payment_method_collection.find(p => p.payment_method_code === 'cvu');
        if(!paymentCol) return { general: 0, volume: 0, fees: 0, taxes: 0 };
        const payinBal = paymentCol.balance_collection.find(b => b.transaction_type === 'Payin');
        if (!payinBal) return { general: 0, volume: 0, fees: 0, taxes: 0 };
        
        return {
            general: parseFloat(payinBal.amount || 0),
            volume: parseFloat(payinBal.operations_amount || 0),
            fees: parseFloat(payinBal.fee_amount || 0),
            taxes: parseFloat(payinBal.tax_amount || 0)
        };
    };

    const getV1TransactionStatus = async (txId, accessToken) => {
        const queryRes = await axios.get(`${envConfig.BASE_URL}/query/payins?transaction_id=${txId}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if(queryRes.data && queryRes.data.rows && queryRes.data.rows.length > 0) {
            return queryRes.data.rows[0];
        }
        return {};
    };

    beforeAll(async () => {
        auditLog = new AuditLogger('V1_PayUrl_Hybrid_Flow_AR');
        
        // Limpiar Sandbox
        await SandboxHelper.cleanOrphanTransactions(SANDBOX_MERCHANT_1_TOKEN, 'merchant1', null, auditLog);
        await SandboxHelper.cleanOrphanTransactions(SANDBOX_MERCHANT_3_TOKEN, 'sand_pay_merch3', 'sand_pay_merch3', auditLog);

        token = await getAccessToken();
        
        try {
            browser = await chromium.launch({ headless: true });
            context = await browser.newContext({ locale: 'es-ES', colorScheme: 'dark' });
            page = await context.newPage();
            page.setDefaultTimeout(20000);
        } catch (e) { console.error("Fallo levantando Playwright", e); }
    });

    afterAll(async () => {
        if (browser) await browser.close();
    });

    test('Omnichannel Hybrid: API Balance -> PayUrl -> UI Extract -> Webhook -> API Balance', async () => {
        auditLog.logTestStart('TC01 - Hybrid PayURL E2E (API + Scrape + Webhook)');

        // ============================================================================== //
        // 1. CAPTURAR DASHBOARD Y SALDOS INICIALES VÍA API
        // ============================================================================== //
        const initialBalances = await getV1MerchantBalance(token);
        
        // ============================================================================== //
        // 2. GENERAR LINK DE PAGO V1 (POST /payurl)
        // ============================================================================== //
        const myRefId = `PayUrl-AR-V1-${Date.now()}`;
        const payUrlEndpoint = `${envConfig.BASE_URL}/payurl`;
        const payurlAmountConfig = 1255.55; 
        
        const validPayload = {
            "country_code": "AR",
            "currency": "ARS",
            "transaction_total": payurlAmountConfig,
            "merchant_transaction_reference": myRefId,
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
        };

        const response = await axios.post(payUrlEndpoint, validPayload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'DisablePartnerMock': 'true'
            },
            validateStatus: () => true
        });

        const txId = response.data.transaction_id || response.data.id;
        auditLog.logTest('API-V1-PAYURL', `PayUrl Link Generation`, payUrlEndpoint, validPayload, response.status, response.data, false, txId);
        
        expect([200, 201]).toContain(response.status);
        
        // ============================================================================== //
        // 3. MATERIALIZAR VOUCHER CON PLAYWRIGHT Y EXTRAER CVU/REFERENCIA
        // ============================================================================== //
        const checkoutUrl = response.data.url || response.data.pay_url || response.data.redirect_url;
        expect(checkoutUrl).toBeDefined();

        let extractedCvu = null;
        let extractedRef = null;

        const checkoutPage = await context.newPage();
        await checkoutPage.goto(checkoutUrl, { waitUntil: 'domcontentloaded' }).catch(() => null);
        await checkoutPage.waitForTimeout(2000); 
        
        const btnSubmit = checkoutPage.locator('button[type="submit"], button:has-text("Continuar")').first();
        if (await btnSubmit.isVisible().catch(() => false)) {
            await btnSubmit.click({ force: true });
            await checkoutPage.waitForTimeout(4000); 
        }

        const bodyText = await checkoutPage.innerText('body').catch(()=>'');
        
        if (allure && allure.attachment) {
            const uiSnap = await checkoutPage.screenshot({ fullPage: true }).catch(() => null);
            if (uiSnap) await allure.attachment(`📸 Evidencia UI Voucher Generado`, uiSnap, "image/png");
        }

        // Expresión regular para extraer CVU/CBU
        const cvuMatch = bodyText.match(/(?:CVU|CBU)[\s\S]*?(\d{22})/i);
        if (cvuMatch && cvuMatch[1]) extractedCvu = cvuMatch[1];

        // Expresión regular para extraer Referencia Bancaria
        const refMatch = bodyText.match(/Referencia de Pago[\s\S]*?(\d{19})/i) || bodyText.match(/(\d{19})/i);
        if (refMatch && refMatch[1]) extractedRef = refMatch[1];

        await checkoutPage.close();

        expect(extractedCvu).not.toBeNull();
        expect(extractedRef).not.toBeNull();

        // ============================================================================== //
        // 4. SIMULAR PAGO EN DINARIA SANDBOX (WEBHOOK)
        // ============================================================================== //
        const simPayload = {
            cbu: extractedCvu,
            cuit: "20084908488", // Sin guiones
            amount: payurlAmountConfig.toFixed(2),
            idTrxCliente: extractedRef,
            nombre: "Sergio Test"
        };

        const simRes = await axios.post(DINARIA_SANDBOX_URL, simPayload, {
            headers: { 'Authorization': `Bearer ${SANDBOX_MERCHANT_3_TOKEN}` },
            validateStatus: () => true
        });

        auditLog.logTest('SANDBOX', `Dinaria Cashin Simulator (Webhook)`, DINARIA_SANDBOX_URL, simPayload, simRes.status, simRes.data, false, extractedRef);
        expect([200, 201]).toContain(simRes.status);

        // ============================================================================== //
        // 5. POLLING ACTIVO ESPERANDO APROBACIÓN
        // ============================================================================== //
        let finalTxStatus = null;
        for (let i = 0; i < 15; i++) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            const stat = await getV1TransactionStatus(txId, token);
            const statusLower = (stat.status || "").toLowerCase();
            if (statusLower === 'approved' || statusLower === 'completed' || statusLower === 'rejected') {
                finalTxStatus = stat;
                break;
            }
        }

        expect(finalTxStatus).not.toBeNull();
        expect((finalTxStatus.status || "").toLowerCase()).toBe('approved');

        // ============================================================================== //
        // 6. BALANCE FINAL Y REPORTE MATEMÁTICO EN AUDITLOGGER
        // ============================================================================== //
        const finalBalances = await getV1MerchantBalance(token);

        const opDiff = parseFloat(finalTxStatus.transaction_total || 0);
        const feeDiff = parseFloat(finalTxStatus.fee || 0);
        const taxDiff = parseFloat(finalTxStatus.calculated_taxes || 0);
        const netValue = parseFloat((opDiff - feeDiff - taxDiff).toFixed(2));

        const balanceMathObject = {
            "0_Context": "PayUrl Omnichannel mathematical validation using Sandbox Webhook",
            "1_Initial_General_Balance": initialBalances.general,
            "2_PayUrl_In_Volume": opDiff,
            "3_Calculated_Fee": feeDiff,
            "4_Calculated_Tax": taxDiff,
            "5_Net_Value_Applied": netValue,
            "6_Final_General_Balance": finalBalances.general,
            "7_Match": Math.abs(parseFloat((initialBalances.general + netValue).toFixed(2)) - finalBalances.general) < 0.01,
            "8_Status": "PASS"
        };

        auditLog.logFlow('PayURL Financial Balance Check', balanceMathObject);

        expect(balanceMathObject["7_Match"]).toBe(true);
    });

});
