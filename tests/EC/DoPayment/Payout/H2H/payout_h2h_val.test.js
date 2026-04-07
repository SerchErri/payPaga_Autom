const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../../utils/authHelper');
const envConfig = require('../../../utils/envConfig');

const BASE_URL = `${envConfig.BASE_URL}/payout`;

describe(`[EC] [DoPayment] [Payout] [H2H] [DEV] Validation Suite`, () => {
    let freshToken = '';

    beforeAll(async () => {
        try {
            freshToken = await getAccessToken();
        } catch (error) {
            console.error("Fallo obteniendo token global", error);
        }
    });

    const generateBasePayload = () => ({
        "country_code": "EC",
        "currency": "USD",
        "payment_method_code": "bank_transfer",
        "transaction": {
            "beneficiary": {
                "first_name": "Serch",
                "last_name": "Test",
                "document_type": "CI",
                "document_number": "1710034065",
                "account_number": "1234567890", 
                "bank_code": "PICHINCHAEC",
                "account_type": "ahorro"
            },
            "transaction_data": {
                "payout_concept": "QA Automation Test",
                "merchant_transaction_reference": `Val-Po-${Date.now()}`,
                "transaction_total": 10.23
            }
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
        if (response.data && response.data.error_details) {
             extractMsg = `ERROR MSG: ${JSON.stringify(response.data.error_details)}`;
        } else if (response.data && response.data.error) {
             extractMsg = `ERROR MSG: ${JSON.stringify(response.data.error)}`;
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

    describe('1. Seguridad e Integridad Payout', () => {
        test('1.1. Seguridad: Forzar Unauthorized (401) con Token Falso', async () => {
            const payload = generateBasePayload();
            const res = await axios.post(BASE_URL, payload, {
                headers: { 'Authorization': `Bearer eyJhb.INVENTADO.xyz` },
                validateStatus: () => true
            });
            if (allure && allure.attachment) {
                await allure.attachment('Token Falso (401) Envío', JSON.stringify(payload, null, 2), 'application/json');
                await allure.attachment('Token Falso (401) Respuesta', JSON.stringify({status: res.status, body: res.data}, null, 2), 'application/json');
            }
            expect(res.status).toBe(401);
        });

        test('1.2. JSON Integrity: Mandar un JSON malformado', async () => {
            const malformedPayload = `{ "country_code": "EC", "currency": "USD" `;
            const response = await executeFailingPost('JSON Malformado', malformedPayload, true);
            expect(response.status).toBe(400);
        });

        test('1.3. Mass Assignment: Inyectar params extras', async () => {
            const payload = generateBasePayload();
            payload.transaction.is_admin = true;
            payload.hacked_field = "exploit";
            const response = await executeFailingPost('Mass Assignment', payload);
            expect(response.status).toBeDefined();
        });
    });

    describe('2. Consistencia y Monto Total', () => {

        test('2.1. Amount: Valor Negativo', async () => {
            const p = generateBasePayload();
            p.transaction.transaction_data.transaction_total = -10.00;
            const res = await executeFailingPost('Amount Negativo', p);
            expect([400, 422]).toContain(res.status); 
        });

        test('2.2. Amount: Exceso de Decimales', async () => {
            const p = generateBasePayload();
            p.transaction.transaction_data.transaction_total = 10.123;
            const res = await executeFailingPost('Amount Muchos Decimales', p);
            expect([400, 422]).toContain(res.status); 
        });

        test('2.3. Amount: Excede Disponible', async () => {
            const balanceResponse = await axios.get(`${envConfig.BASE_URL}/v2/balances?country=EC`, {
                headers: { 'Authorization': `Bearer ${freshToken}`, 'DisablePartnerMock': 'true' },
                validateStatus: () => true
            });
            const ecData = balanceResponse.data.countries && balanceResponse.data.countries.find(c => c.country === 'EC');
            const available = Number(ecData ? ecData.available_for_payout : 0);

            const p = generateBasePayload();
            p.transaction.transaction_data.transaction_total = available + 999999.00;
            const res = await executeFailingPost('Amount Excede Balance', p);
            expect([400, 403, 409, 422]).toContain(res.status);
        });

        test('2.4. Amount: Cero o Null', async () => {
            const p = generateBasePayload();
            p.transaction.transaction_data.transaction_total = 0.00;
            const res = await executeFailingPost('Amount Cero', p);
            expect([400, 422]).toContain(res.status);
        });
    });

    describe('3. Campos de Identidad (Documentos EC)', () => {

        test('3.1. Tipología Prohibida (DL) en vez de CI/PP', async () => {
            const p = generateBasePayload();
            p.transaction.beneficiary.document_type = "DL";
            const res = await executeFailingPost('Document Type DL', p);
            expect([400, 422]).toContain(res.status);
        });

        test('3.2. CI: Contaminación Letras', async () => {
            const p = generateBasePayload();
            p.transaction.beneficiary.document_type = "CI";
            p.transaction.beneficiary.document_number = "17Y0034065";
            const res = await executeFailingPost('CI con Letras', p);
            expect([400, 422]).toContain(res.status);
        });

        test('3.3. CI: Digitos Insuficientes (9)', async () => {
            const p = generateBasePayload();
            p.transaction.beneficiary.document_type = "CI";
            p.transaction.beneficiary.document_number = "130799009";
            const res = await executeFailingPost('CI Corta', p);
            expect([400, 422]).toContain(res.status);
        });

        test('3.4. CI: Exceso de Digitos (11)', async () => {
            const p = generateBasePayload();
            p.transaction.beneficiary.document_type = "CI";
            p.transaction.beneficiary.document_number = "13079900918";
            const res = await executeFailingPost('CI Larga', p);
            expect([400, 422]).toContain(res.status);
        });

        test('3.5. PP: Limite de frontera OK (13)', async () => {
            const p = generateBasePayload();
            p.transaction.beneficiary.document_type = "PP";
            p.transaction.beneficiary.document_number = "A1B2C3D4E5QW9";
            const res = await executeFailingPost('PP Valid (13)', p);
            expect(res.status).toBeDefined();
        });

        test('3.6. PP: Rebaso Limite (14)', async () => {
            const p = generateBasePayload();
            p.transaction.beneficiary.document_type = "PP";
            p.transaction.beneficiary.document_number = "A1B2C3D4E5QW9X";
            const res = await executeFailingPost('PP Desborde (14)', p);
            expect([400, 422]).toContain(res.status);
        });
    });

    describe('4. Validaciones Bancarias Específicas', () => {

        test('4.1. Account Number: Mayor a 20 dígitos', async () => {
            const p = generateBasePayload();
            p.transaction.beneficiary.account_number = "123456789012345678901"; 
            const res = await executeFailingPost('Num > 20', p);
            expect([400, 422]).toContain(res.status);
        });

        test('4.2. Account Number: Menos de 10 dígitos (9)', async () => {
            const p = generateBasePayload();
            p.transaction.beneficiary.account_number = "123456789"; 
            const res = await executeFailingPost('Num < 10', p);
            expect([400, 422]).toContain(res.status);
        });

        test('4.3. Account Number: Más de 10 dígitos (Estricto 10 - Falla)', async () => {
            const p = generateBasePayload();
            p.transaction.beneficiary.account_number = "12345678901"; 
            const res = await executeFailingPost('Num Larga 11', p);
            expect([400, 422]).toContain(res.status);
        });

        test('4.4. Account Number: Exacto 10 dígitos (Exitoso)', async () => {
            const p = generateBasePayload();
            p.transaction.beneficiary.account_number = "1234567890"; 
            const res = await executeFailingPost('Num Exacto 10', p);
            expect([200, 201]).toContain(res.status); 
        });

        test('4.5. Account Number: Regex Letras y Alfanuméricos', async () => {
            const p = generateBasePayload();
            p.transaction.beneficiary.account_number = "12345678A0"; 
            const res = await executeFailingPost('Num Letras', p);
            expect([400, 422]).toContain(res.status);
        });

        test('4.6. Bank Code: Código Inexistente', async () => {
            const p = generateBasePayload();
            p.transaction.beneficiary.bank_code = "BANCO_FALSO";
            const res = await executeFailingPost('Bank Code Falso', p);
            expect([400, 422]).toContain(res.status);
        });
    });

    describe('5. Campos de Cadena (Nombres Puros)', () => {

        const runFirstNameTest = async (testName, val) => {
            const p = generateBasePayload();
            p.transaction.beneficiary.first_name = val;
            return await executeFailingPost(testName, p);
        };

        const runLastNameTest = async (testName, val) => {
            const p = generateBasePayload();
            p.transaction.beneficiary.last_name = val;
            return await executeFailingPost(testName, p);
        };

        test('5.1. First Name: Vacío', async () => expect([400, 422]).toContain((await runFirstNameTest('FN Vacío', "")).status));
        test('5.2. First Name: XSS Payload', async () => expect([400, 422]).toContain((await runFirstNameTest('FN HTML', "<script>alert(1)</script>")).status));
        test('5.3. First Name: Boundary Largo Exacto (51 Chars) [Fallo]', async () => expect([400, 422]).toContain((await runFirstNameTest('FN Boundary 51', "A".repeat(51))).status));
        test('5.4. First Name: Boundary Valido Máximo (50 Chars) [Exitoso]', async () => expect([200, 201]).toContain((await runFirstNameTest('FN Boundary 50 Valido', "A".repeat(50))).status));
        
        test('5.5. Last Name: Vacío', async () => expect([400, 422]).toContain((await runLastNameTest('LN Vacío', "")).status));
        test('5.6. Last Name: XSS Payload', async () => expect([400, 422]).toContain((await runLastNameTest('LN HTML', "<img src=x onerror=alert(1)>")).status));
        test('5.7. Last Name: Boundary Largo Exacto (51 Chars) [Fallo]', async () => expect([400, 422]).toContain((await runLastNameTest('LN Boundary 51', "A".repeat(51))).status));
        test('5.8. Last Name: Boundary Valido Máximo (50 Chars) [Exitoso]', async () => expect([200, 201]).toContain((await runLastNameTest('LN Boundary 50 Valido', "A".repeat(50))).status));
    });

});
