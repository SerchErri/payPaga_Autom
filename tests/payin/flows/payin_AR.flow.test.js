const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../utils/authHelper');
const envConfig = require('../../utils/envConfig');

describe(`Transacciones Pay-In (Argentina) - API de Paypaga [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    test('Flujo Completo: Autenticación -> Configuración (GET) -> Creación de Pay-In (POST)', async () => {
        // ============================================================================== //
        // 1. PASO DE AUTORIZACIÓN (Helper totalmente autogestionado por envConfig.js)
        // ============================================================================== //
        const freshToken = await getAccessToken();

        // ============================================================================== //
        // 2. OBTENER INFORMACIÓN DEL MÉTODO DE PAGO 
        // ============================================================================== //
        // Obtenemos dinámicamente la base del endpoint elegida
        const configUrl = `${envConfig.BASE_URL}/v2/transactions/pay-in/config?country=AR`;
        
        const configResponse = await axios.get(configUrl, {
            headers: {
                'DisablePartnerMock': 'true',
                'Authorization': `Bearer ${freshToken}`
            },
            validateStatus: () => true
        });

        if (configResponse.status !== 200) {
            console.error('El endpoint del GET Config falló:', JSON.stringify(configResponse.data, null, 2));
        }
        expect(configResponse.status).toBe(200);

        if (allure && allure.attachment) {
            await allure.attachment(
                "Paso 2 - Respuesta de configuraciones requeridas AR (GET)", 
                JSON.stringify(configResponse.data, null, 2), 
                "application/json"
            );
        }

        // ============================================================================== //
        // 3. CREACIÓN DEL PAY-IN (Cumpliendo el formato exigido)
        // ============================================================================== //
        const createPayinUrl = `${envConfig.BASE_URL}/v2/transactions/pay-in`;
        
        const referenceId = `D8xohvYrUQlVfVwU-${Date.now()}`;
        
        const payload = {
            "amount": 1000.00,
            "country": "AR",
            "currency": "ARS",
            "payment_method": "cvu",
            "merchant_transaction_reference": referenceId, 
            "merchant_customer_id": envConfig.FRONTEND_PARAMS.email, // Email provisto por ambiente
            "fields": {
                "first_name": "Sergio",
                "last_name": "Aut Test",
                "document_number": "20-27510579-2"
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
            console.error('El endpoint devolvió error al intentar crear Pay-in:', JSON.stringify(postResponse.data, null, 2));
        }

        if (allure && allure.attachment) {
            await allure.attachment(
                 "Paso 3 - Payload POST AR Enviado (Datos Random)", 
                 JSON.stringify(payload, null, 2), 
                 "application/json"
            );
        }

        if (allure && allure.attachment) {
            const trans_id = postResponse.data.transaction_id || postResponse.data.id || 'No Asignado';
            
            await allure.attachment(
                 `Paso 3 - RESPUESTA BACKEND (Transaction ID: ${trans_id})`, 
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
