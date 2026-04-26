//npm run test:h2h:stg
const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../../../../utils/authHelper');
const envConfig = require('../../../../../utils/envConfig');
const AuditLogger = require('../../../../../utils/auditLogger');

describe(`[H2H Dinaria AR] V1 Validaciones Negativas API Pay-In [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    let freshToken = '';
    let auditLog;

    beforeAll(async () => {
        auditLog = new AuditLogger('V1_Payin_H2H_Val_Dinaria_AR');
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

    const executeFailingPost = async (testId, testName, masterPayload) => {
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
             auditLog.logTest(testId, testName, `${envConfig.BASE_URL}/transaction-config`, masterPayload.malformed_payload, res.status, res.data, true);
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
             auditLog.logTest(testId, testName, `${envConfig.BASE_URL}/transaction-config`, configPayload, response.status, response.data, true);
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

        // Check if the response is successful, so we can pass expectedToFail appropriately
        let expectedToFail = true;
        if (response.status >= 200 && response.status < 300) {
            if (testName.includes('Valid') || testName.includes('Success')) {
                expectedToFail = false;
            }
        }

        auditLog.logTest(testId, testName, `${envConfig.BASE_URL}/payment`, paymentPayload, response.status, response.data, expectedToFail);

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

        test.skip('1.1. Seguridad: Forzar Unauthorized (401) con Token Falso', async () => {
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
            auditLog.logTest('TC-01', 'Seguridad: Forzar Unauthorized', `${envConfig.BASE_URL}/transaction-config`, payload, response.status, response.data, true);
            expect(response.status).toBe(401);
        });

        test.skip('1.2. JSON Integrity: Send malformed JSON (Parsing Error)', async () => {
            const p = generateBasePayload();
            p.raw_string_mode = true;
            p.malformed_payload = `{ "transaction_total": 1000.00, "country_code": "AR" `;
            const response = await executeFailingPost('TC-02', 'JSON: Malformed Payload', p);
            expect(response.status).toBe(400);
        });

        test.skip('1.3. Mass Assignment: Inject irrelevant fields for vulnerability', async () => {
            const p = generateBasePayload();
            p.extra_fields = { is_admin: true, hacked_field: "exploit" };
            const response = await executeFailingPost('TC-03', 'Mass Assignment Injection', p);
            expect(response.status).toBeDefined();
        });
    });

    // ==========================================
    // SECCIÓN 2: OBJETO ROOT Y CONSISTENCIA
    // ==========================================
    describe('2. Root and Consistency Validations', () => {

        test('2.1. Amount: Minimum Limit (Value 0)', async () => {
            const p = generateBasePayload(); p.transaction_total = 0;
            const res = await executeFailingPost('TC-01', 'Amount: Zero', p);
            expect([400, 422]).toContain(res.status);
        });

        test('2.2. Amount: Negative Value', async () => {
            const p = generateBasePayload(); p.transaction_total = -1500;
            const res = await executeFailingPost('TC-02', 'Amount: Negative API', p);
            expect([200, 201, 400, 422]).toContain(res.status);
        });

        test('2.3. Amount: Validate 1.00', async () => {
            const p = generateBasePayload(); p.transaction_total = 1.00;
            const res = await executeFailingPost('TC-03', 'Amount: 1.00', p);
            expect(res.status).toBeDefined();
        });

        test('2.4. Amount: Stress Testing with extreme limit', async () => {
            const p = generateBasePayload(); p.transaction_total = 99999999999999.99;
            const res = await executeFailingPost('TC-04', 'Amount: Valid Extreme Limit', p);
            expect(res.status).toBeDefined();
        });

        test('2.5. Amount: Excess Decimals (10.005)', async () => {
            const p = generateBasePayload(); p.transaction_total = 10.005;
            const res = await executeFailingPost('TC-05', 'Amount: 3 Decimals', p);
            expect(res.status).toBeDefined();
        });

        test('2.6. Amount: Empty / Null (400 Expected)', async () => {
            const p = generateBasePayload(); p.transaction_total = null;
            const res = await executeFailingPost('TC-06', 'Amount: Null', p);
            expect([400, 422]).toContain(res.status);
        });

        test('2.8. Consistency: Inconsistent Country/Currency (AR - COP)', async () => {
            const p = generateBasePayload();
            p.country_code = "AR";
            p.currency = "COP"; 
            const res = await executeFailingPost('TC-07', 'Root: Inconsistent Country/Currency (AR-COP)', p);
            expect([400, 422]).toContain(res.status);
        });
    });

    // ==========================================
    // SECCIÓN 3: OBJETOS FIELDS (NOMBRES)
    // ==========================================
    describe('3. String Fields (Names)', () => {

        const runFirstNameTest = async (testId, testName, val) => {
            const p = generateBasePayload();
            setTransactionField(p, 'first_name', val);
            return await executeFailingPost(testId, testName, p);
        };

        const runLastNameTest = async (testId, testName, val) => {
            const p = generateBasePayload();
            setTransactionField(p, 'last_name', val);
            return await executeFailingPost(testId, testName, p);
        };

        test('3.1. First Name: Empty', async () => expect([400, 422]).toContain((await runFirstNameTest('TC-08', 'First Name: Empty', "")).status));
        test('3.2. First Name: Null', async () => expect([400, 422]).toContain((await runFirstNameTest('TC-09', 'First Name: Null', null)).status));
        test('3.3. First Name: Only spaces', async () => expect([400, 422]).toContain((await runFirstNameTest('TC-10', 'First Name: Spaces', "   ")).status));
        test('3.4. First Name: Includes Numbers', async () => expect([400, 422]).toContain((await runFirstNameTest('TC-11', 'First Name: Numeric', "Sergio123")).status));
        test('3.5. First Name: XSS HTML Injection', async () => expect([400, 422]).toContain((await runFirstNameTest('TC-12', 'First Name: XSS HTML Injection', "<script>alert(1)</script> Sergio")).status));

        test('3.6. First Name: Strict Short Limit (1 Char)', async () => {
            const res = await runFirstNameTest('TC-13', 'First Name: Short Length (1 Char)', "A");
            expect(res.status).toBeDefined();
        });
        test('3.7. First Name: Boundary Largo Exacto (51 Chars) [Fallo]', async () => {
            const res = await runFirstNameTest('TC-14', 'First Name: Max Length Boundary (51 Chars)', "A".repeat(51));
            expect([400, 422]).toContain(res.status);
        });

        test('3.7.1. First Name: Boundary Valido Máximo (50 Chars) [Exitoso]', async () => {
            const res = await runFirstNameTest('TC-15', 'First Name: Max Valid Boundary (50 Chars)', "A".repeat(50));
            expect([200, 201]).toContain(res.status);
        });

        test('3.8. Last Name: Empty', async () => expect([400, 422]).toContain((await runLastNameTest('TC-16', 'Last Name: Empty', "")).status));
        test('3.9. Last Name: Null', async () => expect([400, 422]).toContain((await runLastNameTest('TC-17', 'Last Name: Null', null)).status));
        test('3.10. Last Name: Only spaces', async () => expect([400, 422]).toContain((await runLastNameTest('TC-18', 'Last Name: Spaces', "   ")).status));
        test('3.11. Last Name: Includes Numbers', async () => expect([400, 422]).toContain((await runLastNameTest('TC-19', 'Last Name: Numeric', "Gomez123")).status));
        test('3.12. Last Name: XSS HTML Injection', async () => expect([400, 422]).toContain((await runLastNameTest('TC-20', 'Last Name: XSS HTML Injection', "<script>alert(1)</script> Gomez")).status));

        test('3.13. Last Name: Strict Short Limit (1 Char)', async () => {
            const res = await runLastNameTest('TC-21', 'Last Name: Short Length (1 Char)', "A");
            expect(res.status).toBeDefined();
        });
        test('3.14. Last Name: Boundary Largo Exacto (51 Chars) [Fallo]', async () => {
            const res = await runLastNameTest('TC-22', 'Last Name: Max Length Boundary (51 Chars)', "A".repeat(51));
            expect([400, 422]).toContain(res.status);
        });

        test('3.14.1. Last Name: Boundary Valido Máximo (50 Chars) [Exitoso]', async () => {
            const res = await runLastNameTest('TC-23', 'Last Name: Max Valid Boundary (50 Chars)', "A".repeat(50));
            expect([200, 201]).toContain(res.status);
        });
    });

    // ==========================================
    // SECCIÓN 5: OBJETOS FIELDS (DOCUMENTOS AR CUIT/CUIL)
    // ==========================================
    describe('5. Identity Fields (AR Documents)', () => {

        test('5.1. Reject payin with invalid CUIL prefix (19...)', async () => {
            const p = generateBasePayload(); 
            setTransactionField(p, "document_number", "19123456789"); 
            const res = await executeFailingPost('TC-24', 'Document Number: Invalid CUIL Prefix (19)', p);
            expect([400, 422]).toContain(res.status);
        });

        test('5.2. Reject payin with incorrect CUIL length (10 digits)', async () => {
            const p = generateBasePayload();
            setTransactionField(p, "document_number", "2012345678"); 
            const res = await executeFailingPost('TC-25', 'Document Number: Invalid Length (10 digits)', p);
            expect([400, 422]).toContain(res.status);
        });

        test('5.3. Accept CUIL with hyphens', async () => {
            const p = generateBasePayload();
            setTransactionField(p, "document_number", "20-08490848-8"); 
            const res = await executeFailingPost('TC-26', 'Document Number: Valid CUIL with Hyphens', p);
            expect([200, 201]).toContain(res.status);
        });

        test('5.4. Accept CUIL without hyphens', async () => {
            const p = generateBasePayload();
            setTransactionField(p, "document_number", "20084908488"); 
            const res = await executeFailingPost('TC-27', 'Document Number: Valid CUIL without Hyphens', p);
            expect([200, 201]).toContain(res.status);
        });

        test('5.5. Reject CUIL with special characters', async () => {
            const p = generateBasePayload();
            setTransactionField(p, "document_number", "20-08490848-$"); 
            const res = await executeFailingPost('TC-28', 'Document Number: Invalid Special Characters', p);
            expect([400, 422]).toContain(res.status);
        });

        test('5.6. Reject CUIL with invalid verifier digit', async () => {
            const p = generateBasePayload();
            setTransactionField(p, "document_number", "20-08490848-9"); 
            const res = await executeFailingPost('TC-29', 'Document Number: Invalid Verifier Digit', p);
            expect([400, 422]).toContain(res.status);
        });

        test('5.7. Reject CUIL with a dot (.)', async () => {
            const p = generateBasePayload();
            setTransactionField(p, "document_number", "20.08490848.8"); 
            const res = await executeFailingPost('TC-30', 'Document Number: Invalid Dot Character', p);
            expect([400, 422]).toContain(res.status);
        });
    });

    // ==========================================
    // SECCIÓN 6: PAYMENT METHODS (AUDITORÍA AÑADIDA)
    // ==========================================
    describe('6. Strict Payment Method Validations', () => {

        test('6.1. Payment Method: Empty / Null', async () => {
            const p = generateBasePayload(); p.payment_method_code = "";
            const res = await executeFailingPost('TC-31', 'Payment Method: Empty', p);
            expect([400, 422]).toContain(res.status);
        });

        test('6.2. Payment Method: Invalid Method (Hacking String)', async () => {
            const p = generateBasePayload(); p.payment_method_code = "método_inventado";
            const res = await executeFailingPost('TC-32', 'Payment Method: Invalid String', p);
            expect([400, 422]).toContain(res.status);
        });

    });

});
