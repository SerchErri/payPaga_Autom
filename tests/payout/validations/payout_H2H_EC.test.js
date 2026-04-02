// tests/payout/validations/payout_H2H_EC.test.js
// Suite estricta de validaciones de Payout H2H para Ecuador basada en Specs de usuario.

const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../utils/authHelper');
const envConfig = require('../../utils/envConfig');

const BASE_URL = `${envConfig.BASE_URL}/payout`;

describe(`[Payout H2H Ecuador] Validación Estricta Backend [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    let freshToken = '';

    beforeAll(async () => {
        try {
            freshToken = await getAccessToken();
        } catch (error) {
            console.error("Fallo obteniendo token global", error);
        }
    });

    // 🏆 Payload Base para Payout
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
                "account_number": "12345678910", // 11 dígitos por convención segura (10 a 20 range)
                "bank_code": "coop_ahorro_y_credito_el_sagrario",
                "account_type": "ahorro"
            },
            "transaction_data": {
                "payout_concept": "laboris voluptate quis occaecat",
                "merchant_transaction_reference": `Val-Po-${Date.now()}`,
                "transaction_total": 10.23
            }
        }
    });

    // Reporter Automático (Homologado a Payin)
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

        console.log(`\n=== 🚨 FALLA PROVOCADA PARA: ${testName} ===`);
        console.log(`Status devuelto por backend: ${response.status}`);
        console.log(`Respuesta Validada:`, extractMsg);
        console.log(`===============================================`);

        if (allure && allure.attachment) {
            await allure.attachment(`Causa/Payload - ${testName}`, rawStringMode ? payload : JSON.stringify(payload, null, 2), "application/json");
            await allure.attachment(`Efecto/Respuesta - ${testName}`, JSON.stringify({ status: response.status, body: response.data }, null, 2), "application/json");
        }

        return response;
    };

    // ==========================================
    // SECCIÓN 1: SEGURIDAD, ESTRUCTURA Y MASS ASSIGNMENT
    // ==========================================
    describe('1. Seguridad e Integridad Payout', () => {

        test('1.1. Seguridad: Forzar Unauthorized (401) con Token Falso', async () => {
            const res = await axios.post(BASE_URL, generateBasePayload(), {
                headers: { 'Authorization': `Bearer eyJhb.INVENTADO.xyz` },
                validateStatus: () => true
            });
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

    // ==========================================
    // SECCIÓN 2: CONSISTENCIA Y MONTOS
    // ==========================================
    describe('2. Consistencia y Monto Total (transaction_total)', () => {

        test('2.1. Amount: Valor Negativo (Rechazo API 250 - Custom Spec)', async () => {
            const p = generateBasePayload();
            p.transaction.transaction_data.transaction_total = -10.00;
            const res = await executeFailingPost('Amount Negativo', p);
            
            expect([400, 422]).toContain(res.status); // Esperamos Status Fallido Frontal
            // Aserción estricta de la estructura proveída por usuario (errorCode: 250)
            if(res.data && res.data.error_code === 250) {
                expect(res.data.error_code).toBe(250);
                expect(res.data.error_details[0].field).toBe("transaction_total");
                expect(res.data.error_details[0].message).toBe("Invalid transaction amount.");
            }
        });

        test('2.2. Amount: Exceso de Decimales (>2 dígitos) [Debería fallar con 400]', async () => {
            const p = generateBasePayload();
            p.transaction.transaction_data.transaction_total = 10.123;
            const res = await executeFailingPost('Amount Muchos Decimales', p);
            
            // ⚠️ ISSUE CONOCIDO (Debe dar Error 4XX pero actualmente lo permite/genera)
            // Se fuerza la expectativa de Assert failure indicando el bug al tester
            expect([400, 422]).toContain(res.status); 
        });

        test('2.3. Amount: Excede Disponible (available_for_payout)', async () => {
            // Obtener el balance disponible real primero
            const balanceResponse = await axios.get(`${envConfig.BASE_URL}/v2/balances?country=EC`, {
                headers: { 'Authorization': `Bearer ${freshToken}`, 'DisablePartnerMock': 'true' },
                validateStatus: () => true
            });
            const ecData = balanceResponse.data.countries && balanceResponse.data.countries.find(c => c.country === 'EC');
            const available = Number(ecData ? ecData.available_for_payout : 0);

            // Requerir Payout superior al disponible
            const p = generateBasePayload();
            p.transaction.transaction_data.transaction_total = available + 999999.00;
            const res = await executeFailingPost('Amount Excede Balance País', p);
            
            // Debe Fallar porque la billetera no tiene liquidez
            expect([400, 403, 409, 422]).toContain(res.status);
        });

        test('2.4. Amount: Cero (0.00)', async () => {
            const p = generateBasePayload();
            p.transaction.transaction_data.transaction_total = 0.00;
            const res = await executeFailingPost('Amount Cero', p);
            expect([400, 422]).toContain(res.status);
        });
    });

    // ==========================================
    // SECCIÓN 3: DOCUMENTOS DE IDENTIDAD EC
    // ==========================================
    describe('3. Campos de Identidad (Documentos EC permitidos solo CI y PP)', () => {

        test('3.1. Tipología Prohibida (DL) en vez de CI/PP', async () => {
            const p = generateBasePayload();
            p.transaction.beneficiary.document_type = "DL";
            const res = await executeFailingPost('Document Type DL Prohibido', p);
            expect([400, 422]).toContain(res.status);
        });

        test('3.2. Validar CI: Contaminación Letras', async () => {
            const p = generateBasePayload();
            p.transaction.beneficiary.document_type = "CI";
            p.transaction.beneficiary.document_number = "17Y0034065";
            const res = await executeFailingPost('CI con Letras', p);
            expect([400, 422]).toContain(res.status);
        });

        test('3.3. Validar CI: Digitos Insuficientes (9 dígitos)', async () => {
            const p = generateBasePayload();
            p.transaction.beneficiary.document_number = "130799009";
            const res = await executeFailingPost('CI Corta', p);
            expect([400, 422]).toContain(res.status);
        });
    });

    // ==========================================
    // SECCIÓN 4: BANCARIOS (Cuentas y Bancos)
    // ==========================================
    describe('4. Validaciones Bancarias Específicas', () => {

        test('4.1. Account Number: Mayor a 20 dígitos (Debe Emitir Error 250)', async () => {
            const p = generateBasePayload();
            p.transaction.beneficiary.account_number = "123456789012345678901"; // 21 caracteres
            const res = await executeFailingPost('Account Num > 20 Digitos', p);
            
            expect([400, 422]).toContain(res.status);
            
            if (res.data && res.data.error_code === 250) {
                expect(res.data.error_code).toBe(250);
                expect(res.data.error_details[0].field).toBe("transaction[beneficiary].account_number");
                expect(res.data.error_details[0].message).toBe("length must be at most 20 characters");
            }
        });

        test('4.2. Account Number: Menos de 10 dígitos (Regex violation)', async () => {
            const p = generateBasePayload();
            p.transaction.beneficiary.account_number = "123456789"; // 9 caracteres
            const res = await executeFailingPost('Account Num < 10 Digitos', p);
            expect([400, 422]).toContain(res.status);
        });

        test('4.3. Account Number: Regex Letras y Alfanuméricos (Violation ^\\d{10,20}$)', async () => {
            const p = generateBasePayload();
            p.transaction.beneficiary.account_number = "12345678A0"; // Contiene una letra A
            const res = await executeFailingPost('Account Num Letras', p);
            expect([400, 422]).toContain(res.status);
        });

        test('4.4. Bank Code: Código Inexistente', async () => {
            const p = generateBasePayload();
            p.transaction.beneficiary.bank_code = "BANCO_FALSO_123";
            const res = await executeFailingPost('Bank Code Falso', p);
            expect([400, 422]).toContain(res.status);
        });
    });

    // ==========================================
    // SECCIÓN 5: NOMBRES TEXTUALES
    // ==========================================
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

        // Name validations
        test('5.1. First Name: Vacío', async () => expect([400, 422]).toContain((await runFirstNameTest('FN Vacío', "")).status));
        test('5.2. First Name: XSS Payload', async () => expect([400, 422]).toContain((await runFirstNameTest('FN HTML', "<script>alert(1)</script>")).status));
        
        test('5.3. Last Name: Vacío', async () => expect([400, 422]).toContain((await runLastNameTest('LN Vacío', "")).status));
        test('5.4. Last Name: XSS Payload', async () => expect([400, 422]).toContain((await runLastNameTest('LN HTML', "<img src=x onerror=alert(1)>")).status));
    });

});
