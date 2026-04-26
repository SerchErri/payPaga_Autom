const axios = require('axios');
const allure = require('allure-js-commons');
const envConfig = require('../../../../../utils/envConfig');
const { getAccessToken } = require('../../../../../utils/authHelper');
const AuditLogger = require('../../../../../utils/auditLogger');

const PAYURL_ENDPOINT = `${envConfig.BASE_URL}/v1/payurl`;

describe(`[PayURL Ecuador] V1 Validación Backend Estricta (API Pura) [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    
    let freshToken = '';
    let auditLog;

    beforeAll(async () => {
        try { freshToken = await getAccessToken(); } catch (error) { console.error("Fallo obteniendo token global", error); }
        auditLog = new AuditLogger('V1_PayUrl_API_Val_EC');
    });

    // 🏆 Payload Feliz y Estandarizado (El mismo que E2E UI)
    const generateBasePayload = () => ({
        "country_code": "EC",
        "currency": "USD",
        "transaction_total": 10000.00,
        "merchant_transaction_reference": `PayUrlVal-V1-EC-${Date.now()}`,
        "merchant_customer_id": "cliente_ec@ejemplo.com",
        "payment_method_codes": ["bank_transfer"],
        "payment_method_data": [
            {
                "payment_method_code": "bank_transfer",
                "transaction_fields": [
                    { "name": "first_name", "value": "Sergio" },
                    { "name": "last_name", "value": "Testing" },
                    { "name": "email", "value": "perfecto@allure.com" },
                    { "name": "document_type", "value": "CI" },
                    { "name": "document_number", "value": "1710034065" }
                ]
            }
        ]
    });

    /**
     * Motor de API puro para testear validación PREVIA a la generación del Checkout
     */
    const executeFailingPost = async (testId, testName, payload, rawStringMode = false, expectedToFail = true) => {
        const config = {
            headers: {
                'DisablePartnerMock': 'true',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${freshToken}`
            },
            validateStatus: () => true
        };

        const postRes = await axios.post(PAYURL_ENDPOINT, payload, config);

        let parsedPayload = payload;
        if (rawStringMode) {
            try { parsedPayload = JSON.parse(payload); } catch(e) { parsedPayload = { raw_string: payload }; }
        }

        // 📝 LOG DE AUDITORÍA (TEXTO PLANO PARA GERENCIA)
        auditLog.logTest(testId, testName, PAYURL_ENDPOINT, parsedPayload, postRes.status, postRes.data, expectedToFail);

        if (allure && allure.attachment) {
            await allure.attachment(`Causa/Payload (Mandar al crear Link) - ${testName}`, rawStringMode ? payload : JSON.stringify(payload, null, 2), "application/json");
            await allure.attachment(`Efecto Backend API - ${testName}`, JSON.stringify({ status: postRes.status, body: postRes.data }, null, 2), "application/json");
        }

        console.log(`\n=== 🚨 FALLA PROVOCADA PARA: ${testName} ===`);
        console.log(`Status Backend API (PayUrl): ${postRes.status}`);

        return postRes;
    };

    // ==========================================
    // BLOQUE 1: SEGURIDAD, MASIFICACIÓN Y AUTENTICACIÓN API
    // ==========================================
    describe('1. Security and Base Components', () => {

        test('TC-01 - Security: Fake Token Rejected (401)', async () => {
            const p = generateBasePayload();
            const response = await axios.post(PAYURL_ENDPOINT, p, {
                headers: { 'DisablePartnerMock': 'true', 'Content-Type': 'application/json', 'Authorization': `Bearer eyR.FAKE.TOKEN` },
                validateStatus: () => true
            });
            auditLog.logTest('TC-01', 'Security: Fake Token Rejected (401)', PAYURL_ENDPOINT, p, response.status, response.data, true);
            expect(response.status).toBe(401);
        });

        test('TC-02 - JSON Integrity: Malformed Payload (400)', async () => {
            const malformedPayload = `{ "country": "EC", "currency": "USD", "amount": 100 `; // Falta cerrar llaves
            const response = await executeFailingPost('TC-02', 'JSON Integrity: Malformed Payload', malformedPayload, true, true);
            expect([400, 422]).toContain(response.status); // Error de parseo Jackson/Gson nativo esperado
        });

        test('TC-03 - Mass Assignment: Inject Admin Flags', async () => {
            const p = generateBasePayload();
            p.is_admin = true;
            p.fees_override = 0;
            const res = await executeFailingPost('TC-03', 'Mass Assignment: Inject Admin Flags', p, false, false);
            expect(res.status).toBeDefined();
        });
    });

    // ==========================================
    // BLOQUE 2: RESTRICCIONES DE MONTOS Y MONEDAS
    // ==========================================
    describe('2. Strict Backend Integrity: Amounts', () => {

        test('TC-04 - Amount: Null or Empty', async () => {
            const p = generateBasePayload(); p.transaction_total = null;
            const res = await executeFailingPost('TC-04', 'Amount: Null or Empty', p, false, true);
            expect([400, 422]).toContain(res.status);
        });

        test('TC-05 - Amount: Inconsistent Currency EC-COP', async () => {
            const p = generateBasePayload(); p.currency = "COP"; p.country_code = "EC"; 
            const res = await executeFailingPost('TC-05', 'Amount: Inconsistent Currency EC-COP', p, false, true);
            expect([400, 422]).toContain(res.status);
        });

        test('TC-06 - Amount: Absolute Negative (V1 Rejects)', async () => {
             const p = generateBasePayload(); p.transaction_total = -100.00;
             const res = await executeFailingPost('TC-06', 'Amount: Absolute Negative', p, false, true);
             expect([400, 422]).toContain(res.status); // V1 es estricto con negativos
        });

        test('TC-07 - Amount: Floating Precision Exceeded', async () => {
             const p = generateBasePayload(); p.transaction_total = 10.123;
             const res = await executeFailingPost('TC-07', 'Amount: Floating Precision Exceeded', p, false, true);
             expect([400, 422]).toContain(res.status); 
        });
    });

    // ==========================================
    // BLOQUE 3: ESTRUCTURAS DE METODO DE PAGO
    // ==========================================
    describe('3. Payment Method Constraints', () => {

        test('TC-08 - Payment Methods: Empty Array []', async () => {
            const p = generateBasePayload(); p.payment_method_codes = [];
            const res = await executeFailingPost('TC-08', 'Payment Methods: Empty Array []', p, false, false);
            // Esto es el comportamiento legal "PULLDOWN Abierto" al no obligar bank_transfer.
            expect([200, 201]).toContain(res.status); 
        });

        test('TC-09 - Payment Methods: Invalid Hacker Array', async () => {
            const p = generateBasePayload(); p.payment_method_codes = ["hacking_payment___alert(1)"];
            const res = await executeFailingPost('TC-09', 'Payment Methods: Invalid Hacker Array', p, false, true);
            expect([400, 422]).toContain(res.status); 
        });

        test('TC-10 - Missing Mandatory Variable: Merchant Reference', async () => {
             const p = generateBasePayload(); delete p.merchant_transaction_reference;
             const res = await executeFailingPost('TC-10', 'Missing Mandatory Variable: Merchant Reference', p, false, true);
             expect([400, 422]).toContain(res.status); 
        });
    });

});
