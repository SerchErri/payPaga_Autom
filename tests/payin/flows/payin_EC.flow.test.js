const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../utils/authHelper');
const envConfig = require('../../utils/envConfig');

describe(`Transacciones Pay-In (Ecuador) - API de Paypaga [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    test('Flujo Completo: Autenticación -> Configuración EC (GET) -> Creación de Pay-In (POST)', async () => {
        // ============================================================================== //
        // 1. PASO DE AUTORIZACIÓN (Helper auto-gestiona el entorno)
        // ============================================================================== //
        const freshToken = await getAccessToken();

        // ============================================================================== //
        // 2. OBTENER INFORMACIÓN DEL MÉTODO DE PAGO para ECUADOR (EC) 
        // ============================================================================== //
        const configUrl = `${envConfig.BASE_URL}/v2/transactions/pay-in/config?country=EC`;
        
        const configResponse = await axios.get(configUrl, {
            headers: {
                'DisablePartnerMock': 'true',
                'Authorization': `Bearer ${freshToken}`
            },
            validateStatus: () => true
        });

        if (configResponse.status !== 200) {
            console.error('El endpoint del GET Config EC falló:', JSON.stringify(configResponse.data, null, 2));
        }
        expect(configResponse.status).toBe(200);

        if (allure && allure.attachment) {
            await allure.attachment(
                `Paso 2 - Respuesta Config EC [${envConfig.currentEnvName.toUpperCase()}]`, 
                JSON.stringify(configResponse.data, null, 2), 
                "application/json"
            );
        }

        // ============================================================================== //
        // 3. CREACIÓN DEL PAY-IN EC 
        // ============================================================================== //
        const createPayinUrl = `${envConfig.BASE_URL}/v2/transactions/pay-in`;
        
        const referenceId = `EC-test-${Date.now()}`;
        const payload = {
            "amount": 10000.00,
            "country": "EC",
            "currency": "USD",
            "payment_method": "bank_transfer",
            "merchant_transaction_reference": referenceId,
            "merchant_return_url": `${envConfig.BASE_URL}/pay/completed`,
            "merchant_customer_id": envConfig.FRONTEND_PARAMS.email,
            "fields": {
                "first_name": "Sergio",
                "last_name": "Testing",
                "document_number": "1710034065",
                "document_type": "CI",
                "email": "perfecto@allure.com"
            }
        };

        const postResponse = await axios.post(createPayinUrl, payload, {
            headers: {
                'DisablePartnerMock': 'true',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${freshToken}`
            },
            validateStatus: () => true
        });

        if (postResponse.status !== 200 && postResponse.status !== 201) {
            console.error(`El endpoint devolvió error al intentar crear Pay-in EC en ${envConfig.currentEnvName.toUpperCase()}:`, JSON.stringify(postResponse.data, null, 2));
        }

        if (allure && allure.attachment) {
            await allure.attachment(
                 `Paso 3 - Payload POST EC Enviado [${envConfig.currentEnvName.toUpperCase()}]`, 
                 JSON.stringify(payload, null, 2), 
                 "application/json"
            );
        }

        if (allure && allure.attachment) {
            const trans_id = postResponse.data.transaction_id || postResponse.data.id || 'No Asignado';
            
            await allure.attachment(
                 `Paso 3 - RESPUESTA BACKEND EC (Transaction ID: ${trans_id})`, 
                 JSON.stringify({ 
                    transaction_id: trans_id,
                    merchant_reference_enviado: referenceId, 
                    respuesta_completa_del_backend: postResponse.data 
                 }, null, 2), 
                 "application/json"
            );
        }

        expect([200, 201]).toContain(postResponse.status);
        expect(postResponse.data).toBeDefined();
    });

});
