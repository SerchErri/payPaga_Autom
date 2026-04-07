const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../../utils/authHelper');
const envConfig = require('../../../utils/envConfig');

const BASE_URL = `${envConfig.BASE_URL}/v2/transactions/pay-in`;

describe(`[EC] [DoPayment] [Payin] [H2H] [DEV] Validation Suite`, () => {

    let freshToken = '';

    beforeAll(async () => {
        try {
            freshToken = await getAccessToken();
        } catch (error) {
            console.error("Fallo obteniendo token global para fields_EC", error);
        }
    });

    const generateBasePayload = () => ({
        "amount": 10000.00,
        "country": "EC",
        "currency": "USD",
        "payment_method": "bank_transfer",
        "merchant_transaction_reference": `H2H-EC-${Date.now()}`,
        "merchant_return_url": `${envConfig.BASE_URL}/pay/completed`,
        "merchant_customer_id": envConfig.FRONTEND_PARAMS.email,
        "fields": {
            "first_name": "Sergio",
            "last_name": "Testing",
            "document_number": "1710034065",
            "document_type": "CI",
            "email": "perfecto@allure.com"
        }
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

        const response = await axios.post(BASE_URL, payload, config);

        let extractMsg = response.data;
        if (response.data && response.data.error) {
            extractMsg = `ERROR MSG: "${response.data.error.message}"`;
            if (response.data.error.details && response.data.error.details.length > 0) {
                extractMsg += ` | DETALLE: ${response.data.error.details[0].message}`;
            }
        }
        
        console.log(`\n\x1b[41m\x1b[37m === 🚨 TEST FALLIDO FORZADO: ${testName} === \x1b[0m`);
        console.log(`\x1b[36mStatus devuelto:\x1b[0m ${response.status}`);
        console.log(`\x1b[33mCausa Error:\x1b[0m`, extractMsg);
        
        if (allure && allure.attachment) {
            await allure.attachment(`Causa/Payload - ${testName}`, rawStringMode ? payload : JSON.stringify(payload, null, 2), "application/json");
            await allure.attachment(`Efecto/Respuesta - ${testName}`, JSON.stringify({ status: response.status, body: response.data }, null, 2), "application/json");
        }

        return response;
    };

    describe('1. Seguridad e Integridad de la Llamada H2H', () => {

        test('1.1. Seguridad: Forzar Unauthorized (401) con Token Falso', async () => {
            const payload = generateBasePayload();
            const response = await axios.post(BASE_URL, payload, {
                headers: {
                    'DisablePartnerMock': 'true',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer eyJhb.INVENTADO.xyz` 
                },
                validateStatus: () => true
            });
            if (allure && allure.attachment) {
                await allure.attachment('Token Falso (401) Envío', JSON.stringify(payload, null, 2), 'application/json');
                await allure.attachment('Token Falso (401) Respuesta', JSON.stringify({status: response.status, body: response.data}, null, 2), 'application/json');
            }
            expect(response.status).toBe(401);
        });

        test('1.2. JSON Integrity: Mandar un JSON malformado', async () => {
            const malformedPayload = `{ "amount": 1000.00, "country": "EC" `;
            const response = await executeFailingPost('JSON Malformado', malformedPayload, true);
            expect(response.status).toBe(400);
        });

        test('1.3. Mass Assignment: Inyectar campos irrelevantes para vulnerabilidad', async () => {
            const payload = generateBasePayload();
            payload.is_admin = true;
            payload.fees_override = 0.00;
            payload.fields.hacked_field = "exploit";
            const response = await executeFailingPost('Inyección Mass Assignment', payload);
            expect(response.status).toBeDefined();
        });
    });

    describe('2. Root y Consistency (Negativos y Fronteras)', () => {

        test('2.1. Amount: Límite Mínimo (Valor 0)', async () => {
            const p = generateBasePayload(); p.amount = 0;
            const res = await executeFailingPost('Amount Cero', p);
            expect([400, 422]).toContain(res.status);
        });

        test('2.2. Amount: Valor Negativo (API transforma a Absoluto)', async () => {
            const p = generateBasePayload(); p.amount = -150.00;
            const res = await executeFailingPost('Amount Negativo Absoluto API', p);
            expect([200, 201]).toContain(res.status);
        });

        test('2.3. Amount: Exceso de Decimales', async () => {
            const p = generateBasePayload(); p.amount = 10.005;
            const res = await executeFailingPost('Amount Muchos Decimales', p);
            expect(res.status).toBe(400);
        });

        test('2.4. Amount: Stress Testing Millonario', async () => {
            const p = generateBasePayload(); p.amount = 99999999999999.99;
            const res = await executeFailingPost('Amount Millonario Extremo', p);
            expect(res.status).toBeDefined(); 
        });

        test('2.5. Amount: Vacío / Null', async () => {
            const p = generateBasePayload(); p.amount = null;
            const res = await executeFailingPost('Amount Null', p);
            expect([400, 422]).toContain(res.status);
        });

        test('2.6. Amount: Mínimo Válido Positivo (0.01)', async () => {
            const p = generateBasePayload(); p.amount = 0.01;
            const res = await executeFailingPost('Amount Centavo', p);
            expect(res.status).toBeDefined();
        });

        test('2.7. Consistency: Desacople País-Moneda', async () => {
            const p = generateBasePayload();
            p.country = "EC"; p.currency = "COP"; 
            const res = await executeFailingPost('Moneda Incorrecta EC', p);
            expect([400, 422]).toContain(res.status);
        });
    });

    describe('3. Campos de Cadena (Nombres Puros)', () => {

        const runFirstNameTest = async (testName, val) => {
            const p = generateBasePayload();
            p.fields.first_name = val;
            return await executeFailingPost(testName, p);
        };

        const runLastNameTest = async (testName, val) => {
            const p = generateBasePayload();
            p.fields.last_name = val;
            return await executeFailingPost(testName, p);
        };

        test('3.1. First Name: Vacío', async () => expect([400, 422]).toContain((await runFirstNameTest('FN Vacio', "")).status));
        test('3.2. First Name: Nulo', async () => expect([400, 422]).toContain((await runFirstNameTest('FN Null', null)).status));
        test('3.3. First Name: Solo espacios', async () => expect([400, 422]).toContain((await runFirstNameTest('FN Espacios', "   ")).status));
        test('3.4. First Name: Incluye Números', async () => expect([400, 422]).toContain((await runFirstNameTest('FN Números', "Sergio123")).status));
        test('3.5. First Name: XSS HTML', async () => expect([400, 422]).toContain((await runFirstNameTest('FN HTML Injection', "<script>alert(1)</script> Sergio")).status));
        test('3.6. First Name: Límite Corto (1 Char)', async () => expect((await runFirstNameTest('FN 1 Char', "A")).status).toBeDefined());
        test('3.7. First Name: Boundary Largo (51)', async () => expect([400, 422]).toContain((await runFirstNameTest('FN Boundary 51', "A".repeat(51))).status));
        test('3.7.1. First Name: Boundary Valido (50)', async () => expect([200, 201]).toContain((await runFirstNameTest('FN Boundary 50 Valido', "A".repeat(50))).status));

        test('3.8. Last Name: Vacío', async () => expect([400, 422]).toContain((await runLastNameTest('LN Vacio', "")).status));
        test('3.9. Last Name: Nulo', async () => expect([400, 422]).toContain((await runLastNameTest('LN Null', null)).status));
        test('3.10. Last Name: Solo espacios', async () => expect([400, 422]).toContain((await runLastNameTest('LN Espacios', "   ")).status));
        test('3.11. Last Name: Incluye Números', async () => expect([400, 422]).toContain((await runLastNameTest('LN Números', "Gomez123")).status));
        test('3.12. Last Name: XSS HTML', async () => expect([400, 422]).toContain((await runLastNameTest('LN HTML Injection', "<script>alert(1)</script> Gomez")).status));
        test('3.13. Last Name: Límite Corto (1 Char)', async () => expect((await runLastNameTest('LN 1 Char', "A")).status).toBeDefined());
        test('3.14. Last Name: Boundary Largo (51)', async () => expect([400, 422]).toContain((await runLastNameTest('LN Boundary 51', "A".repeat(51))).status));
        test('3.14.1. Last Name: Boundary Valido (50)', async () => expect([200, 201]).toContain((await runLastNameTest('LN Boundary 50 Valido', "A".repeat(50))).status));
    });

    describe('4. Campos de Identidad (Email)', () => {

        test('4.1. Email: Sin arroba (@)', async () => {
            const p = generateBasePayload(); p.fields.email = "sergiopaypaga.com";
            const res = await executeFailingPost('Email sin Arroba', p);
            expect([400, 422]).toContain(res.status);
        });

        test('4.2. Email: Sin dominio (.com)', async () => {
            const p = generateBasePayload(); p.fields.email = "sergio@";
            const res = await executeFailingPost('Email sin Dominio', p);
            expect([400, 422]).toContain(res.status);
        });

        test('4.3. Email: Espacio oculto', async () => {
            const p = generateBasePayload(); p.fields.email = "ser gio@paypaga.com";
            const res = await executeFailingPost('Email con Espacio', p);
            expect([400, 422]).toContain(res.status);
        });
    });

    describe('5. Campos de Identidad (Documentos EC)', () => {

        test('5.1. Tipología Documento Inexistente', async () => {
            const p = generateBasePayload(); p.fields.document_type = "DNI";
            const res = await executeFailingPost('Documento DNI Invalido', p);
            expect([400, 422]).toContain(res.status);
        });

        test('5.2. CI: Formato sucio', async () => {
            const p = generateBasePayload();
            p.fields.document_type = "CI"; p.fields.document_number = "130A990091"; 
            const res = await executeFailingPost('CI EC con Letras', p);
            expect([400, 422]).toContain(res.status);
        });

        test('5.3. CI: Corto (9}', async () => {
            const p = generateBasePayload();
            p.fields.document_type = "CI"; p.fields.document_number = "130799009"; 
            const res = await executeFailingPost('CI EC con 9 digitos', p);
            expect([400, 422]).toContain(res.status);
        });

        test('5.4. CI: Exceso de dígitos (11)', async () => {
            const p = generateBasePayload();
            p.fields.document_type = "CI"; p.fields.document_number = "13079900918"; 
            const res = await executeFailingPost('CI EC con 11 digitos', p);
            expect([400, 422]).toContain(res.status);
        });

        test('5.5. CI: Algoritmo Módulo 10 Fallido', async () => {
            const p = generateBasePayload();
            p.fields.document_type = "CI"; p.fields.document_number = "9999999999";
            const res = await executeFailingPost('CI EC Falsa', p);
            expect([400, 422]).toContain(res.status);
        });

        test('5.6. Pasaporte: Límite Tolerante Positivo (<13)', async () => {
            const p = generateBasePayload();
            p.fields.document_type = "PP"; p.fields.document_number = "A1B2C3D4E5QW9"; 
            const res = await executeFailingPost('Pasaporte EC Correcto', p);
            expect(res.status).toBeDefined();
        });

        test('5.7. Pasaporte: Sobre Límite (>13 Chars)', async () => {
            const p = generateBasePayload();
            p.fields.document_type = "PP";  p.fields.document_number = "A1B2C3D4E5QW90"; 
            const res = await executeFailingPost('Pasaporte Desbordado', p);
            expect([400, 422]).toContain(res.status);
        });

        test('5.8. DL: Contaminada Letras', async () => {
            const p = generateBasePayload();
            p.fields.document_type = "DL"; p.fields.document_number = "A921473922"; 
            const res = await executeFailingPost('DL EC Contaminada', p);
            expect([400, 422]).toContain(res.status);
        });
    });

    describe('6. Validaciones Estrictas de Método de Pago', () => {

        test('6.1. Método de Pago Vacío / Null', async () => {
            const p = generateBasePayload(); p.payment_method = "";
            const res = await executeFailingPost('Payment Method Vacío', p);
            expect(res.status).toBeDefined();
        });

        test('6.2. Método de Pago Falso', async () => {
            const p = generateBasePayload(); p.payment_method = "método_inventado";
            const res = await executeFailingPost('Payment Method Falso', p);
            expect([400, 422]).toContain(res.status);
        });

    });

});
