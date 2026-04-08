const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../../../../utils/authHelper');
const envConfig = require('../../../../../utils/envConfig');

describe(`[EC] [DoPayment] [Payout] [H2H] Camino Feliz y Saldo (available_for_payout) [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    let token = '';

    beforeAll(async () => {
        token = await getAccessToken();
    });

    // Tiempo global amplio
    jest.setTimeout(30000); 

    test('Flujo Completo: Verificar Saldo y Ejecutar Payout sin superarlo', async () => {
        // ==========================================
        // 1. OBTENER SALDO DEL PAÍS (EC)
        // ==========================================
        const balanceUrl = `${envConfig.BASE_URL}/v2/balances?country=EC`;
        const balanceResponse = await axios.get(balanceUrl, {
            headers: { 'Authorization': `Bearer ${token}`, 'DisablePartnerMock': 'true' },
            validateStatus: () => true,
        });

        if (allure && allure.attachment) {
             await allure.attachment('Balance País EC', JSON.stringify(balanceResponse.data, null, 2), 'application/json');
        }
        
        expect(balanceResponse.status).toBe(200);
        const ecData = balanceResponse.data.countries && balanceResponse.data.countries.find(c => c.country === 'EC');
        const available = Number(ecData ? ecData.available_for_payout : 0);
        expect(available).toBeGreaterThanOrEqual(0);

        // ==========================================
        // 2. DEFINIR MONTO Y PREPARAR PAYLOAD
        // ==========================================
        const desiredAmount = 10.23;
        // Evitamos enviar mayor valor del disponible en base al spec.
        const payoutAmount = Math.min(desiredAmount, available);

        const payoutUrl = `${envConfig.BASE_URL}/payout`;
        const payload = {
            country_code: 'EC',
            currency: 'USD',
            payment_method_code: 'bank_transfer',
            transaction: {
                beneficiary: {
                    first_name: 'Serch',
                    last_name: 'Test',
                    document_type: 'CI',
                    document_number: '1710034065',
                    account_number: '1234567891',
                    bank_code: 'coop_ahorro_y_credito_el_sagrario',
                    account_type: 'ahorro',
                },
                transaction_data: {
                    payout_concept: 'Validacion Happy Path Payout',
                    merchant_transaction_reference: `H2H-Flow-${Date.now()}`,
                    transaction_total: payoutAmount,
                },
            },
        };

        // ==========================================
        // 3. EJECUTAR PAYOUT HTTP POST
        // ==========================================
        const res = await axios.post(payoutUrl, payload, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'DisablePartnerMock': 'true',
            },
            validateStatus: () => true,
        });

        if (allure && allure.attachment) {
            await allure.attachment('Payout H2H Enviado', JSON.stringify(payload, null, 2), 'application/json');
            await allure.attachment('Respuesta Payout', JSON.stringify(res.data, null, 2), 'application/json');
        }

        // ==========================================
        // 4. VALIDACIONES ESTRUCTURALES DEL ÉXITO
        // ==========================================
        expect([200, 201]).toContain(res.status);
        expect(res.data).toBeDefined();
        
        // Comprobación secundaria del importe si el backend lo devuelve validado
        if (res.data && res.data.transaction_total !== undefined) {
            expect(Number(res.data.transaction_total)).toBeCloseTo(payoutAmount, 2);
        }
    });
});
