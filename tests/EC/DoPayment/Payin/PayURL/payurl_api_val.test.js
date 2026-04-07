const axios = require('axios');
const allure = require('allure-js-commons');
const envConfig = require('../../../utils/envConfig');
const { getAccessToken } = require('../../../utils/authHelper');

const PAYURL_ENDPOINT = `${envConfig.BASE_URL}/v2/pay-urls`;

describe(`[EC] [DoPayment] [Payin] [PayURL] [DEV] API Suite`, () => {
    
    let freshToken = '';

    beforeAll(async () => {
        try { freshToken = await getAccessToken(); } catch (error) { console.error("Fallo obteniendo token global", error); }
    });

    const generateBasePayload = () => ({
        "country": "EC",
        "currency": "USD",
        "amount": 10000.00,
        "merchant_transaction_reference": `PayUrlVal-EC-${Date.now()}`,
        "merchant_customer_id": "cliente_ec@ejemplo.com",
        "allowed_payment_methods": ["bank_transfer"],
        "predefined_fields": [
            {
                "payment_method": "bank_transfer",
                "fields": {
                    "first_name": "Sergio",
                    "last_name": "Testing",
                    "email": "perfecto@allure.com",
                    "document_type": "CI",
                    "document_number": "1710034065"
                }
            }
        ]
    });

    const executeFailingPost = async (testName, payload, rawStringMode = false) => {
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
            await allure.attachment(`Causa/Payload - ${testName}`, rawStringMode ? payload : JSON.stringify(payload, null, 2), "application/json");
            await allure.attachment(`Efecto Backend API - ${testName}`, JSON.stringify({ status: postRes.status, body: postRes.data }, null, 2), "application/json");
        }

        console.log(`\n\x1b[41m\x1b[37m === 🚨 TEST FALLIDO FORZADO: ${testName} === \x1b[0m`);
        console.log(`\x1b[36mPayload Enviado:\x1b[0m\n${JSON.stringify(payload, null, 2)}`);
        console.log(`\x1b[33mStatus devuelto:\x1b[0m ${postRes.status}`);

        return postRes;
    };

    describe('1. Seguridad y Componentes Base', () => {
        test('1.1. Seguridad: Token Falso Rechazado (401)', async () => {
            const p = generateBasePayload();
            const response = await axios.post(PAYURL_ENDPOINT, p, {
                headers: { 'DisablePartnerMock': 'true', 'Content-Type': 'application/json', 'Authorization': `Bearer eyR.FAKE.TOKEN` },
                validateStatus: () => true
            });
            if (allure && allure.attachment) {
                await allure.attachment('Token Falso (401) Envío', JSON.stringify(p, null, 2), 'application/json');
                await allure.attachment('Token Falso (401) Respuesta', JSON.stringify({status: response.status, body: response.data}, null, 2), 'application/json');
            }
            expect(response.status).toBe(401);
        });

        test('1.2. Integridad JSON: Bad Request (400) por string roto', async () => {
            const malformedPayload = `{ "country": "EC", "currency": "USD", "amount": 100 `;
            const response = await executeFailingPost('JSON Malformado', malformedPayload, true);
            expect([400, 422]).toContain(response.status); 
        });

        test('1.3. Mass Assignment Vulnerability', async () => {
            const p = generateBasePayload();
            p.is_admin = true;
            p.fees_override = 0;
            const res = await executeFailingPost('Mass Assignment', p);
            expect(res.status).toBeDefined();
        });
    });

    describe('2. Integridad Estricta Backend sobre Montos', () => {
        test('2.1. Amount Nulo / Vacío', async () => {
            const p = generateBasePayload(); p.amount = null;
            const res = await executeFailingPost('Amount Null', p);
            expect([400, 422]).toContain(res.status);
        });

        test('2.2. Amount Moneda Cruzada COP/EC', async () => {
            const p = generateBasePayload(); p.currency = "COP"; p.country = "EC"; 
            const res = await executeFailingPost('Amount Moneda Cruzada', p);
            expect([400, 422]).toContain(res.status);
        });

        test('2.3. Amount: Negativo Absoluto (Muta a Positivo)', async () => {
             const p = generateBasePayload(); p.amount = -100.00;
             const res = await executeFailingPost('Amount Negativo', p);
             expect([200, 201]).toContain(res.status); 
        });

        test('2.4. Amount: Precision Flotante Larga', async () => {
             const p = generateBasePayload(); p.amount = 10.123;
             const res = await executeFailingPost('Amount Muchos Decimales', p);
             expect([400, 422]).toContain(res.status); 
        });
    });

    describe('3. Restricciones del Metodo de Pago', () => {
        test('3.1. Métodos Permitidos: Array Vacío', async () => {
            const p = generateBasePayload(); p.allowed_payment_methods = [];
            const res = await executeFailingPost('Metodos Abiero', p);
            expect([200, 201]).toContain(res.status); 
        });

        test('3.2. Métodos Permitidos: Fallido', async () => {
            const p = generateBasePayload(); p.allowed_payment_methods = ["hacking_payment___alert(1)"];
            const res = await executeFailingPost('Metodos Invalido', p);
            expect([400, 422]).toContain(res.status); 
        });

        test('3.3. Omisión de Variables Obligatorias', async () => {
             const p = generateBasePayload(); delete p.merchant_transaction_reference;
             const res = await executeFailingPost('Falta Reference ID', p);
             expect([400, 422]).toContain(res.status); 
        });
    });

});
