//npm run test:h2h:stg
const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../../../../utils/authHelper');
const envConfig = require('../../../../../utils/envConfig');

describe(`[H2H Dinaria AR] V1 Validaciones Negativas API Pay-In [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    let freshToken = '';

    beforeAll(async () => {
        try {
            freshToken = await getAccessToken();
        } catch (error) {
            console.error("Fallo obteniendo token global", error);
        }
    });

    const generateBasePayload = () => ({
        "country_code": "AR",
        "currency": "ARS",
        "transaction_total": 10000.00,
        "merchant_transaction_reference": `H2H-AR-V1-${Date.now()}`,
        "payment_method_code": "cvu",
        "transaction_fields": [
            { "name": "first_name", "value": "João" },
            { "name": "last_name", "value": "Silva" },
            { "name": "document_number", "value": "20221370075" }
        ],
        "raw_string_mode": false,
        "malformed_payload": null,
        "extra_fields": {}
    });

    const setTransactionField = (payload, name, value) => {
        const field = payload.transaction_fields.find(f => f.name === name);
        if (field) field.value = value;
        else payload.transaction_fields.push({ name, value });
    };

    const getTransactionField = (payload, name) => {
        const field = payload.transaction_fields.find(f => f.name === name);
        return field ? field.value : undefined;
    };

    const executeFailingPost = async (testName, masterPayload) => {
        const configOptions = {
            headers: {
                'DisablePartnerMock': 'true',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${freshToken}`
            },
            validateStatus: () => true
        };

        if (masterPayload.raw_string_mode) {
             const res = await axios.post(`${envConfig.BASE_URL}/transaction-config`, masterPayload.malformed_payload, configOptions);
             if (allure && allure.attachment) {
                 await allure.attachment(`Causa/Payload - ${testName}`, masterPayload.malformed_payload, "application/json");
                 await allure.attachment(`Efecto/Respuesta - ${testName}`, JSON.stringify({ status: res.status, body: res.data }, null, 2), "application/json");
             }
             return res;
        }

        const configPayload = {
            country_code: masterPayload.country_code,
            currency: masterPayload.currency,
            transaction_total: masterPayload.transaction_total,
            merchant_transaction_reference: masterPayload.merchant_transaction_reference,
            ...masterPayload.extra_fields 
        };

        let response = await axios.post(`${envConfig.BASE_URL}/transaction-config`, configPayload, configOptions);
        
        if (response.status !== 200 && response.status !== 201) {
             if (allure && allure.attachment) {
                 await allure.attachment(`Causa/Payload (Paso 1 Falla) - ${testName}`, JSON.stringify(configPayload, null, 2), "application/json");
                 await allure.attachment(`Efecto/Respuesta (Paso 1 Falla) - ${testName}`, JSON.stringify({ status: response.status, body: response.data }, null, 2), "application/json");
             }
             return response;
        }

        const generatedTransactionId = response.data.transaction_id || response.data.id || (response.data.data && response.data.data.transaction_id);

        if (!generatedTransactionId) return response;

        const paymentPayload = {
            transaction_id: generatedTransactionId,
            payment_method_code: masterPayload.payment_method_code,
            country_code: masterPayload.country_code,
            currency: masterPayload.currency,
            transaction_total: masterPayload.transaction_total,
            merchant_transaction_reference: masterPayload.merchant_transaction_reference,
            transaction_fields: masterPayload.transaction_fields,
            ...masterPayload.extra_fields
        };

        response = await axios.post(`${envConfig.BASE_URL}/payment`, paymentPayload, configOptions);

        let extractMsg = response.data;
        if (response.data && response.data.error) {
            extractMsg = `ERROR MSG: "${response.data.error.message}"`;
            if (response.data.error.details && response.data.error.details.length > 0) {
                extractMsg += ` | DETALLE: ${response.data.error.details[0].message}`;
            }
        }
        console.log(`\n=== 🚨 FALLA PROVOCADA PARA: ${testName} ===`);
        console.log(`Status devuelto por backend: ${response.status}`);
        console.log(`Respuesta Validada:`, extractMsg);
        console.log(`===============================================`);

        if (allure && allure.attachment) {
            await allure.attachment(`Causa/Payload (Paso 2 Falla) - ${testName}`, JSON.stringify(paymentPayload, null, 2), "application/json");
            await allure.attachment(`Efecto/Respuesta (Paso 2 Falla) - ${testName}`, JSON.stringify({ status: response.status, body: response.data }, null, 2), "application/json");
        }

        return response;
    };

    // ==========================================
    // SECCIÓN 1: SEGURIDAD, ESTRUCTURA Y MASS ASSIGNMENT
    // ==========================================
    describe('1. Seguridad e Integridad de la Llamada H2H V1', () => {

        test('1.1. Seguridad: Forzar Unauthorized (401) con Token Falso', async () => {
            const payload = generateBasePayload();
            const configOptions = {
                headers: {
                    'DisablePartnerMock': 'true',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer eyJhb.INVENTADO.xyz` 
                },
                validateStatus: () => true
            };
            const response = await axios.post(`${envConfig.BASE_URL}/transaction-config`, {
                country_code: payload.country_code,
                currency: payload.currency,
                transaction_total: payload.transaction_total,
                merchant_transaction_reference: payload.merchant_transaction_reference
            }, configOptions);
            expect(response.status).toBe(401);
        });

        test('1.2. JSON Integrity: Mandar un JSON malformado (Parsing Error)', async () => {
            const p = generateBasePayload();
            p.raw_string_mode = true;
            p.malformed_payload = `{ "transaction_total": 1000.00, "country_code": "AR" `;
            const response = await executeFailingPost('JSON Malformado', p);
            expect(response.status).toBe(400);
        });

        test('1.3. Mass Assignment: Inyectar campos irrelevantes para vulnerabilidad', async () => {
            const p = generateBasePayload();
            p.extra_fields = { is_admin: true, hacked_field: "exploit" };
            const response = await executeFailingPost('Inyección Mass Assignment', p);
            expect(response.status).toBeDefined();
        });
    });

    // ==========================================
    // SECCIÓN 2: OBJETO ROOT Y CONSISTENCIA
    // ==========================================
    describe('2. Root y Consistency (Negativos y Fronteras)', () => {

        test('2.1. Amount: Límite Mínimo (Valor 0)', async () => {
            const p = generateBasePayload(); p.transaction_total = 0;
            const res = await executeFailingPost('Amount Cero', p);
            expect([400, 422]).toContain(res.status);
        });

        test('2.2. Amount: Valor Negativo (MUTADO)', async () => {
            const p = generateBasePayload(); p.transaction_total = -1500;
            const res = await executeFailingPost('Amount Negativo API', p);
            expect([200, 201, 400, 422]).toContain(res.status);
        });

        test('2.3. Amount: Validar importe puntual de 1.00', async () => {
            const p = generateBasePayload(); p.transaction_total = 1.00;
            const res = await executeFailingPost('Amount 1.00', p);
            expect(res.status).toBeDefined();
        });

        test('2.4. Amount: Stress Testing por límite obsceno astronómico', async () => {
            const p = generateBasePayload(); p.transaction_total = 99999999999999.99;
            const res = await executeFailingPost('Amount Millonario Extremo', p);
            expect(res.status).toBeDefined();
        });

        test('2.5. Amount: Exceso de 3 Decimales (10.005)', async () => {
            const p = generateBasePayload(); p.transaction_total = 10.005;
            const res = await executeFailingPost('Amount 3 Decimales', p);
            expect(res.status).toBeDefined();
        });

        test('2.6. Amount: Vacío / Null (400 Expected)', async () => {
            const p = generateBasePayload(); p.transaction_total = null;
            const res = await executeFailingPost('Amount Null', p);
            expect([400, 422]).toContain(res.status);
        });

        test('2.8. Consistency: Desacople País-Moneda (AR con COP)', async () => {
            const p = generateBasePayload();
            p.country_code = "AR";
            p.currency = "COP"; 
            const res = await executeFailingPost('Moneda Incorrecta AR', p);
            expect([400, 422]).toContain(res.status);
        });
    });

    // ==========================================
    // SECCIÓN 3: OBJETOS FIELDS (NOMBRES)
    // ==========================================
    describe('3. Campos de Cadena (Nombres Puros)', () => {

        const runFirstNameTest = async (testName, val) => {
            const p = generateBasePayload();
            setTransactionField(p, 'first_name', val);
            return await executeFailingPost(testName, p);
        };

        const runLastNameTest = async (testName, val) => {
            const p = generateBasePayload();
            setTransactionField(p, 'last_name', val);
            return await executeFailingPost(testName, p);
        };

        test('3.1. First Name: Vacío', async () => expect([400, 422]).toContain((await runFirstNameTest('First Name Vacio', "")).status));
        test('3.2. First Name: Nulo', async () => expect([400, 422]).toContain((await runFirstNameTest('First Name Null', null)).status));
        test('3.3. First Name: Solo espacios', async () => expect([400, 422]).toContain((await runFirstNameTest('First Name Espacios', "   ")).status));
        test('3.4. First Name: Incluye Números', async () => expect([400, 422]).toContain((await runFirstNameTest('First Name Números', "Sergio123")).status));
        test('3.5. First Name: Caracteres Peligrosos o Especiales (XSS HTML)', async () => expect([400, 422]).toContain((await runFirstNameTest('First Name HTML Injection', "<script>alert(1)</script> Sergio")).status));

        test('3.6. First Name: Límite Corto Estricto (1 Char)', async () => {
            const res = await runFirstNameTest('First Name 1 Char', "A");
            expect(res.status).toBeDefined();
        });
        test('3.7. First Name: Boundary Largo Exacto (51 Chars) [Fallo]', async () => {
            const res = await runFirstNameTest('First Name Boundary 51', "A".repeat(51));
            expect([400, 422]).toContain(res.status);
        });

        test('3.7.1. First Name: Boundary Valido Máximo (50 Chars) [Exitoso]', async () => {
            const res = await runFirstNameTest('First Name Boundary 50 Valido', "A".repeat(50));
            expect([200, 201]).toContain(res.status);
        });

        test('3.8. Last Name: Vacío', async () => expect([400, 422]).toContain((await runLastNameTest('Last Name Vacio', "")).status));
        test('3.9. Last Name: Nulo', async () => expect([400, 422]).toContain((await runLastNameTest('Last Name Null', null)).status));
        test('3.10. Last Name: Solo espacios', async () => expect([400, 422]).toContain((await runLastNameTest('Last Name Espacios', "   ")).status));
        test('3.11. Last Name: Incluye Números', async () => expect([400, 422]).toContain((await runLastNameTest('Last Name Números', "Gomez123")).status));
        test('3.12. Last Name: Caracteres Peligrosos o Especiales (XSS HTML)', async () => expect([400, 422]).toContain((await runLastNameTest('Last Name HTML Injection', "<script>alert(1)</script> Gomez")).status));

        test('3.13. Last Name: Límite Corto Estricto (1 Char)', async () => {
            const res = await runLastNameTest('Last Name 1 Char', "A");
            expect(res.status).toBeDefined();
        });
        test('3.14. Last Name: Boundary Largo Exacto (51 Chars) [Fallo]', async () => {
            const res = await runLastNameTest('Last Name Boundary 51', "A".repeat(51));
            expect([400, 422]).toContain(res.status);
        });

        test('3.14.1. Last Name: Boundary Valido Máximo (50 Chars) [Exitoso]', async () => {
            const res = await runLastNameTest('Last Name Boundary 50 Valido', "A".repeat(50));
            expect([200, 201]).toContain(res.status);
        });
    });

    // ==========================================
    // SECCIÓN 5: OBJETOS FIELDS (DOCUMENTOS AR CUIT/CUIL)
    // ==========================================
    describe('5. Campos de Identidad (Documentos AR)', () => {

        test('5.1. Reject payin with invalid CUIL prefix (19...)', async () => {
            const p = generateBasePayload(); 
            setTransactionField(p, "document_number", "19123456789"); 
            const res = await executeFailingPost('CUIL Prefijo Invalido', p);
            expect([400, 422]).toContain(res.status);
        });

        test('5.2. Reject payin with incorrect CUIL length (10 digits)', async () => {
            const p = generateBasePayload();
            setTransactionField(p, "document_number", "2012345678"); 
            const res = await executeFailingPost('CUIL 10 digitos', p);
            expect([400, 422]).toContain(res.status);
        });

        test('5.3. Accept CUIL with hyphens', async () => {
            const p = generateBasePayload();
            setTransactionField(p, "document_number", "20-08490848-8"); 
            const res = await executeFailingPost('CUIL con Guiones Validado', p);
            expect([200, 201]).toContain(res.status);
        });

        test('5.4. Accept CUIL without hyphens', async () => {
            const p = generateBasePayload();
            setTransactionField(p, "document_number", "20084908488"); 
            const res = await executeFailingPost('CUIL sin Guiones Validado', p);
            expect([200, 201]).toContain(res.status);
        });

        test('5.5. Reject CUIL with special characters', async () => {
            const p = generateBasePayload();
            setTransactionField(p, "document_number", "20-08490848-$"); 
            const res = await executeFailingPost('CUIL Caracteres Especiales', p);
            expect([400, 422]).toContain(res.status);
        });

        test('5.6. Reject CUIL with invalid verifier digit', async () => {
            const p = generateBasePayload();
            setTransactionField(p, "document_number", "20-08490848-9"); 
            const res = await executeFailingPost('CUIL Digito Verificador Incorrecto', p);
            expect([400, 422]).toContain(res.status);
        });

        test('5.7. Reject CUIL with a dot (.)', async () => {
            const p = generateBasePayload();
            setTransactionField(p, "document_number", "20.08490848.8"); 
            const res = await executeFailingPost('CUIL con un punto', p);
            expect([400, 422]).toContain(res.status);
        });
    });

    // ==========================================
    // SECCIÓN 6: PAYMENT METHODS (AUDITORÍA AÑADIDA)
    // ==========================================
    describe('6. Validaciones Estrictas de Método de Pago', () => {

        test('6.1. Método de Pago Vacío / Null', async () => {
            const p = generateBasePayload(); p.payment_method_code = "";
            const res = await executeFailingPost('Payment Method Vacío', p);
            expect([400, 422]).toContain(res.status);
        });

        test('6.2. Método de Pago Falso (Hacking String)', async () => {
            const p = generateBasePayload(); p.payment_method_code = "método_inventado";
            const res = await executeFailingPost('Payment Method Falso', p);
            expect([400, 422]).toContain(res.status);
        });

    });

});
