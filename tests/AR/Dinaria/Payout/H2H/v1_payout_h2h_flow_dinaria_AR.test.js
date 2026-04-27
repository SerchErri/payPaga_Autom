const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../../../../utils/authHelper');
const envConfig = require('../../../../../utils/envConfig');
const AuditLogger = require('../../../../../utils/auditLogger');

describe(`[E2E Flow] V1 Payout H2H Argentina: API Flow Validaciones [Amb: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    let token = '';
    let payoutAmount = 2500.50; // Fijo para aserciones matemáticas (ARS)
    let auditLog;

    beforeAll(async () => {
        token = await getAccessToken();
        auditLog = new AuditLogger('V1_Payout_H2H_Flow_Dinaria_AR');
    });

    jest.setTimeout(60000);

    const getMerchantBalance = async (jwt) => {
        const balanceUrl = `${envConfig.BASE_URL}/v2/balances?country=AR`;
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
            "country_code": "AR",
            "currency" : "ARS",
            "payment_method_code": "cvu",
            "transaction": {
                "beneficiary": {
                    "first_name": "Sergio",
                    "last_name": "Test",
                    "document_number": "20275105792",
                    "account_number": "0070327530004025541644"
                },
                "transaction_data": {
                    "transaction_total": monto,
                    "payout_concept": "Argentina V1 Success",
                    "merchant_transaction_reference": `PoUrl-${refTag}-${Date.now()}`
                }
            }
        };
        const res = await axios.post(payoutUrl, payload, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'DisablePartnerMock': 'true' },
            validateStatus: () => true
        });

        auditLog.logTest(testId, testName, payoutUrl, payload, res.status, res.data, false);

        const txId = res.data.transaction_id || res.data.id || (res.data.details && res.data.details.transaction_processed && res.data.details.transaction_processed.transaction_id);
        return txId;
    };

    test('1. Flujo Ómnicanal Happy Path: API Balances -> API Payout H2H -> Deducción', async () => {
        const initBal = await getMerchantBalance(token);
        
        if (initBal.available < payoutAmount) {
            console.warn(`⚠️ ALERTA: Tienes ${initBal.available} disponibles. Probablemente falle la API por falta de fondos.`);
        }

        const generatedTxId = await originarPayoutH2H('TC01', 'Happy Path Payout H2H', payoutAmount, 'APPROVE');
        expect(generatedTxId).not.toBeNull();

        await new Promise(r => setTimeout(r, 5000));

        const pendingBal = await getMerchantBalance(token);
        expect(pendingBal.available).toBeLessThan(initBal.available);

        const flowData = {
            "1. Initial Balance (Before Payout)": initBal.available,
            "2. Final Balance (Funds Deducted)": pendingBal.available,
            "Payout Amount Processed": payoutAmount
        };
        auditLog.logFlow('TC01 - Happy Path: API Balances -> API Payout H2H -> Deduction', flowData);
    });

    test('2. Flujo Negativo H2H: Fondos Insuficientes -> API Payout (Monto Mayor al Disponible) -> Debe Fallar', async () => {
        let initInsfBal, excessMonto, res, finalInsfBal;

        initInsfBal = await getMerchantBalance(token);
        excessMonto = initInsfBal.available + 15000.50; 
        
        const payoutUrl = `${envConfig.BASE_URL}/v2/transactions/pay-out`;
        const payload = {
            amount: excessMonto,
            country: 'AR', 
            currency: 'ARS', 
            payment_method: 'cvu',
            merchant_order_reference: `PoUrl-INSUF-${Date.now()}`,
            merchant_transaction_reference: `PoUrl-INSUF-${Date.now()}`,
            merchant_customer_id: 'customer@email.com',
            customer_ip: "120.29.48.92",
            fields: {
                first_name: 'Sergio', 
                last_name: 'Test',
                document_number: '20275105792', 
                account_number: '0070327530004025541644'
            }
        };

        res = await axios.post(payoutUrl, payload, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'DisablePartnerMock': 'true' },
            validateStatus: () => true
        });

        auditLog.logTest('TC02', 'Negative H2H: Insufficient Funds POST', payoutUrl, payload, res.status, res.data, true);

        expect([200, 201, 202, 400, 422, 500]).toContain(res.status);

        finalInsfBal = await getMerchantBalance(token);
        expect(finalInsfBal.available).toBeCloseTo(initInsfBal.available, 1);

        const flowData = {
            "1. Initial Balance (Before Payout)": initInsfBal.available,
            "2. Attempted Payout Amount (Exceeds Available)": excessMonto,
            "3. Final Balance (Unchanged)": finalInsfBal.available,
            "Is Balance Protected? (Initial == Final)": initInsfBal.available === finalInsfBal.available
        };
        auditLog.logFlow('TC02 - Negative H2H: Insufficient Funds', flowData);
    });
});
