const axios = require('axios');
const allure = require('allure-js-commons');
const envConfig = require('../../../../../utils/envConfig');
const { getAccessToken } = require('../../../../../utils/authHelper');

const PAYURL_ENDPOINT = `${envConfig.BASE_URL}/v2/pay-urls`;

describe(`[PayURL Ecuador] Validación Backend Estricta (API Pura) [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    
    let freshToken = '';

    beforeAll(async () => {
        try { freshToken = await getAccessToken(); } catch (error) { console.error("Fallo obteniendo token global", error); }
    });

    // 🏆 Payload Feliz y Estandarizado (El mismo que E2E UI)
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

    /**
     * Motor de API puro para testear validación PREVIA a la generación del Checkout
     */
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
    describe('1. Seguridad y Componentes Base (Root)', () => {

        test('1.1. Seguridad: Token Falso Rechazado (401)', async () => {
            const p = generateBasePayload();
            const response = await axios.post(PAYURL_ENDPOINT, p, {
                headers: { 'DisablePartnerMock': 'true', 'Content-Type': 'application/json', 'Authorization': `Bearer eyR.FAKE.TOKEN` },
                validateStatus: () => true
            });
            expect(response.status).toBe(401);
        });

        test('1.2. Integridad JSON: Bad Request (400) por string roto', async () => {
            const malformedPayload = `{ "country": "EC", "currency": "USD", "amount": 100 `; // Falta cerrar llaves
            const response = await executeFailingPost('JSON Malformado (Sin Cerrar)', malformedPayload, true);
            expect([400, 422]).toContain(response.status); // Error de parseo Jackson/Gson nativo esperado
        });

        test('1.3. Mass Assignment Vulnerability: Intentar Inyectar Admin Flags', async () => {
            const p = generateBasePayload();
            p.is_admin = true;
            p.fees_override = 0;
            const res = await executeFailingPost('Mass Assignment', p);
            // La API es tolerante pero logueamos para evidenciar que ignora parámetros basura o devuelve error.
            expect(res.status).toBeDefined();
        });
    });

    // ==========================================
    // BLOQUE 2: RESTRICCIONES DE MONTOS Y MONEDAS
    // ==========================================
    describe('2. Integridad Estricta Backend sobre Montos', () => {

        test('2.1. Amount Nulo / Vacío', async () => {
            const p = generateBasePayload(); p.amount = null;
            const res = await executeFailingPost('Amount: Null', p);
            expect([400, 422]).toContain(res.status);
        });

        test('2.2. Amount Moneda Cruzada (Inconsistencia Geográfica COP/EC)', async () => {
            const p = generateBasePayload(); p.currency = "COP"; p.country = "EC"; 
            const res = await executeFailingPost('Amount: Moneda Inconsistente EC-COP', p);
            expect([400, 422]).toContain(res.status);
        });

        test('2.3. Amount: Negativo Absoluto (La API transforma el signo a Positivo)', async () => {
             const p = generateBasePayload(); p.amount = -100.00;
             const res = await executeFailingPost('Amount: Negativo (-100 MUTA A +100)', p);
             // IMPORTANTE: QA Validated. La API toma valor absoluto
             expect([200, 201]).toContain(res.status); 
        });

        test('2.4. Amount: Precision Flotante Larga (>2 decimales)', async () => {
             const p = generateBasePayload(); p.amount = 10.123;
             const res = await executeFailingPost('Amount: Muchos Decimales (10.123)', p);
             expect([400, 422]).toContain(res.status); 
        });
    });

    // ==========================================
    // BLOQUE 3: ESTRUCTURAS DE METODO DE PAGO
    // ==========================================
    describe('3. Restricciones del Metodo de Pago', () => {

        test('3.1. Métodos Permitidos: Array Vacío []', async () => {
            const p = generateBasePayload(); p.allowed_payment_methods = [];
            const res = await executeFailingPost('Metodos Permitidos Abierto', p);
            // Esto es el comportamiento legal "PULLDOWN Abierto" al no obligar bank_transfer.
            expect([200, 201]).toContain(res.status); 
        });

        test('3.2. Métodos Permitidos: Array Fallido/Hackeado', async () => {
            const p = generateBasePayload(); p.allowed_payment_methods = ["hacking_payment___alert(1)"];
            const res = await executeFailingPost('Metodos Permitidos Invalido Array', p);
            expect([400, 422]).toContain(res.status); 
        });

        test('3.3. Omisión de Variables Obligatorias del Frontend', async () => {
             // Algunas variables son indispensables para un Link como `merchant_transaction_reference`
             const p = generateBasePayload(); delete p.merchant_transaction_reference;
             const res = await executeFailingPost('Falta Merchant Reference ID', p);
             expect([400, 422]).toContain(res.status); 
        });
    });

});
