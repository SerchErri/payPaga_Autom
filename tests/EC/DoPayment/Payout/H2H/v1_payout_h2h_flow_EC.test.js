const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../../../../utils/authHelper');
const envConfig = require('../../../../../utils/envConfig');
const AuditLogger = require('../../../../../utils/auditLogger');

describe(`[E2E Flow] V1 Payout H2H Ecuador: API Flow Validaciones [Amb: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    let token = '';
    let payoutAmount = 150.50; // Fijo para aserciones matemáticas (USD)
    let auditLog;

    beforeAll(async () => {
        token = await getAccessToken();
        auditLog = new AuditLogger('V1_Payout_H2H_Flow_EC');
    });

    jest.setTimeout(60000);

    const getMerchantBalance = async (jwt) => {
        const balanceUrl = `${envConfig.BASE_URL}/v2/balances?country=EC`;
        const res = await axios.get(balanceUrl, { headers: { 'Authorization': `Bearer ${jwt}` }, validateStatus: () => true });
        
        let available = 0;
        if (res.status === 200 && res.data && res.data.countries && res.data.countries.length > 0) {
            available = res.data.countries[0].available_for_payout || 0;
        }
        return { available, fullResponse: res.data };
    };

    const originarPayoutH2H = async (testId, testName, monto, refTag) => {
        const payoutUrl = `${envConfig.BASE_URL}/v1/payout`;
        const payload = {
            "country_code": "EC",
            "currency": "USD",
            "payment_method_code": "bank_transfer",
            "transaction": {
                "beneficiary": {
                    "first_name": "Sergio",
                    "last_name": "Errigo",
                    "document_type": "CI",
                    "document_number": "1710034065",
                    "account_type": "ahorro",
                    "account_number": "2201234567",
                    "bank_code": "banco_pichincha"
                },
                "transaction_data": {
                    "transaction_total": monto,
                    "merchant_transaction_reference": `H2H-EC-FLOW-${refTag}-${Date.now()}`
                }
            }
        };

        const res = await axios.post(payoutUrl, payload, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'DisablePartnerMock': 'true' },
            validateStatus: () => true
        });

        auditLog.logTest(testId, testName, payoutUrl, payload, res.status, res.data, false);

        const txId = res.data.transaction_id || res.data.id || (res.data.details && res.data.details.transaction_processed && res.data.details.transaction_processed.transaction_id);
        
        if (allure && allure.attachment) {
            await allure.attachment(`POST Response: ${testName} [HTTP ${res.status}]`, JSON.stringify(res.data, null, 2), 'application/json');
        }

        return txId;
    };

    test('1. Flujo Ómnicanal Happy Path: API Balances -> API Payout H2H -> Deducción', async () => {
        const initBal = await getMerchantBalance(token);
        
        if (initBal.available < payoutAmount) {
            console.warn(`⚠️ ALERTA: Tienes ${initBal.available} disponibles. Probablemente falle la API por falta de fondos.`);
        }

        const generatedTxId = await originarPayoutH2H('TC_FLOW_01', 'Happy Path Payout H2H', payoutAmount, 'APPROVE');
        expect(generatedTxId).not.toBeNull();

        await new Promise(r => setTimeout(r, 5000));

        const pendingBal = await getMerchantBalance(token);
        expect(pendingBal.available).toBeLessThan(initBal.available);

        const flowData = {
            "1. Initial Balance (Before Payout)": initBal.available,
            "2. Final Balance (Funds Deducted)": pendingBal.available,
            "Payout Amount Processed": payoutAmount
        };
        auditLog.logFlow('TC_FLOW_01 - Happy Path: API Balances -> API Payout H2H -> Deduction', flowData);
    });

    test('2. Flujo Negativo H2H: Fondos Insuficientes -> API Payout (Monto Mayor al Disponible) -> Debe Fallar', async () => {
        const initInsfBal = await getMerchantBalance(token);
        const excessMonto = initInsfBal.available + 15000.50; 
        
        const payoutUrl = `${envConfig.BASE_URL}/v1/payout`;
        const payload = {
            "country_code": "EC",
            "currency": "USD",
            "payment_method_code": "bank_transfer",
            "transaction": {
                "beneficiary": {
                    "first_name": "Sergio",
                    "last_name": "Errigo",
                    "document_type": "CI",
                    "document_number": "1710034065",
                    "account_type": "ahorro",
                    "account_number": "2201234567",
                    "bank_code": "banco_pichincha"
                },
                "transaction_data": {
                    "transaction_total": excessMonto,
                    "merchant_transaction_reference": `H2H-EC-INSUF-${Date.now()}`
                }
            }
        };

        const res = await axios.post(payoutUrl, payload, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'DisablePartnerMock': 'true' },
            validateStatus: () => true
        });

        // Como es asíncrono, la llamada POST inicial SÍ es exitosa (200 o 202). No falla en el HTTP.
        auditLog.logTest('TC_FLOW_02', 'Flujo Insuficiente H2H (Generación)', payoutUrl, payload, res.status, res.data, false);

        // Se acepta 200 o 202 (Asíncrono), o 400/422 (Síncrono)
        expect([200, 201, 202, 400, 422]).toContain(res.status);

        await new Promise(r => setTimeout(r, 5000)); // Esperar a que el motor asíncrono lo marque como fallido

        // Validamos el estado real de la transacción con un GET
        const txId = res.data.transaction_id || res.data.id || (res.data.details && res.data.details.transaction_processed && res.data.details.transaction_processed.transaction_id);
        if (txId) {
            const getUrl = `${envConfig.BASE_URL}/v2/transactions/pay-out/${txId}`;
            const statusRes = await axios.get(getUrl, {
                headers: { 'Authorization': `Bearer ${token}` },
                validateStatus: () => true
            });
            const estadoActual = statusRes.data.status || statusRes.data.transaction_status || (statusRes.data.data && statusRes.data.data.status);
            
            auditLog.logTest('TC_FLOW_02_GET', 'Verificación de Estado Asíncrono', getUrl, { method: "GET", url_consultada: getUrl }, statusRes.status, statusRes.data, false);
            
            // Validamos que el backend realmente lo haya rechazado
            expect(estadoActual).toMatch(/failed|rejected|declined|error/i);
        }

        const finalInsfBal = await getMerchantBalance(token);

        // Validamos que el balance no fue afectado por la orden rechazada
        expect(finalInsfBal.available).toBeCloseTo(initInsfBal.available, 1);

        const flowData = {
            "1. Initial Balance": initInsfBal.available,
            "2. Final Balance (Unchanged)": finalInsfBal.available,
            "Attempted Processing Amount": excessMonto,
            "Expected Result": "Rejected via API"
        };
        auditLog.logFlow('TC_FLOW_02 - Insufficient Funds API Flow', flowData);
    });

});
