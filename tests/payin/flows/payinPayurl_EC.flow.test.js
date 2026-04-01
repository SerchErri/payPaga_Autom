const axios = require('axios');
const allure = require('allure-js-commons');
const envConfig = require('../../../utils/envConfig');
const { getAccessToken } = require('../../../utils/authHelper');

describe(`Flujo E2E: Crear Link de Pago (PayUrl) EC [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    
    let token = '';

    beforeAll(async () => {
        token = await getAccessToken();
    });

    test('1. Obtener Configuración de Ecuador (GET Config)', async () => {
        // Validamos qué métodos están vivos para Ecuador antes de disparar un POST
        const configUrl = `${envConfig.BASE_URL}/v2/transactions/pay-in/config?country=EC`;
        
        const response = await axios.get(configUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'DisablePartnerMock': 'true'
            }
        });

        // Adjuntos para visual QA
        if (allure && allure.attachment) {
            await allure.attachment("Response Config EC", JSON.stringify(response.data, null, 2), "application/json");
        }

        expect(response.status).toBe(200);
        // El atributo País viaja en QueryParams, por lo que el Backend no siempre lo re-inserta en el response root.
    });

    test('2. Generar Link de Pago Exitoso (POST /v2/pay-urls)', async () => {
        const payUrlEndpoint = `${envConfig.BASE_URL}/v2/pay-urls`;
        const validPayload = {
            "country": "EC",
            "currency": "USD",
            "amount": 10000.00,
            "merchant_transaction_reference": `PayUrl-EC-${Date.now()}`,
            "merchant_customer_id": "cliente_ec@ejemplo.com",
            "allowed_payment_methods": ["bank_transfer"],
            "predefined_fields": [
                {
                    "payment_method": "bank_transfer",
                    "fields": {
                        "first_name": "Sergio",
                        "last_name": "Testing",
                        "document_number": "1710034065",
                        "document_type": "CI",
                        "email": "perfecto@allure.com"
                    }
                }
            ]
        };

        if (allure && allure.attachment) {
            await allure.attachment("Request Carga Feliz", JSON.stringify(validPayload, null, 2), "application/json");
        }

        const response = await axios.post(payUrlEndpoint, validPayload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'DisablePartnerMock': 'true'
            },
            validateStatus: () => true // Prevent Axios Throw on 4XX to evaluate manually
        });

        if (allure && allure.attachment) {
            await allure.attachment("Response PayURL Exitosa", JSON.stringify({ status: response.status, body: response.data }, null, 2), "application/json");
        }

        // El happy path de un Checkout Session o PayUrl debe devolver su ID y la ruta a seguir
        expect(response.status).toBe(201); 
        expect(response.data.transaction_id).toBeDefined();

        console.log(`\n🎉 Link de Pago Generado Correctamente [EC]: ${response.status}`);
        console.dir(response.data, { depth: null });
    });

});
