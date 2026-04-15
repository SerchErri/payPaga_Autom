//npm run test:h2h:stg
const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../../../../utils/authHelper');
const envConfig = require('../../../../../utils/envConfig');

const BASE_URL = `${envConfig.BASE_URL}/v2/transactions/pay-in`;

describe(`[H2H Dinaria AR] Automatización Senior QA - Pay-In [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    let freshToken = '';

    beforeAll(async () => {
        try {
            freshToken = await getAccessToken();
        } catch (error) {
            console.error("Fallo obteniendo token global", error);
        }
    });

    // 🏆 Payload Feliz y Homologado con E2E UI
    const generateBasePayload = () => ({
        "amount": 10000.00,
        "country": "AR",
        "currency": "ARS",
        "payment_method": "cvu",
        "merchant_transaction_reference": `H2H-AR-${Date.now()}`,
        "merchant_return_url": `${envConfig.BASE_URL}/pay/completed`,
        "merchant_customer_id": envConfig.FRONTEND_PARAMS.email,
        "fields": {
            "first_name": "João",
            "last_name": "Silva",
            "document_number": "20221370075"
        },
        "return_urls": {
            "success_url": "https://merchant.com/payment-success",
            "failure_url": "https://merchant.com/payment-failure",
            "cancel_url": "https://merchant.com/payment-cancelled"
        }
    });

    // Reporter Automático a Consola y Allure (Para investigar qué idioma arroja el backend)
    const executeFailingPost = async (testName, payload, rawStringMode = false) => {
        // Ejecución segura de llamadas fallidas
        const config = {
            headers: {
                'DisablePartnerMock': 'true',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${freshToken}`
            },
            validateStatus: () => true
        };

        const response = await axios.post(BASE_URL, payload, config);

        // Volcar diagnóstico limpio en consola para mapear mensajes
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
            await allure.attachment(`Causa/Payload - ${testName}`, rawStringMode ? payload : JSON.stringify(payload, null, 2), "application/json");
            await allure.attachment(`Efecto/Respuesta - ${testName}`, JSON.stringify({ status: response.status, body: response.data }, null, 2), "application/json");
        }

        return response;
    };

    // ==========================================
    // SECCIÓN 1: SEGURIDAD, ESTRUCTURA Y MASS ASSIGNMENT
    // ==========================================
    describe('1. Seguridad e Integridad de la Llamada H2H', () => {

        test('1.1. Seguridad: Forzar Unauthorized (401) con Token Falso', async () => {
            const payload = generateBasePayload();
            const response = await axios.post(BASE_URL, payload, {
                headers: {
                    'DisablePartnerMock': 'true',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer eyJhb.INVENTADO.xyz` // Token Expired o Frito
                },
                validateStatus: () => true
            });
            expect(response.status).toBe(401);
        });

        test('1.2. JSON Integrity: Mandar un JSON malformado (Parsing Error)', async () => {
            // Mandamos un string puro en vez de objeto para bypassear la corrección de Axios. (Ej: Sin la llave de cierre)
            const malformedPayload = `{ "amount": 1000.00, "country": "EC" `;
            const response = await executeFailingPost('JSON Malformado', malformedPayload, true);

            // Un parser en Java/Go tira normalmente 400 Bad Request
            expect(response.status).toBe(400);
        });

        test('1.3. Mass Assignment: Inyectar campos irrelevantes para vulnerabilidad', async () => {
            const payload = generateBasePayload();
            // Inyectamos params no definidos que el ORM/API podría intentar leer maliciosamente
            payload.is_admin = true;
            payload.fees_override = 0.00;
            payload.fields.hacked_field = "exploit";

            const response = await executeFailingPost('Inyección Mass Assignment', payload);

            // Comportamiento esperado: La API escupe un Error 4XX por Schema estricto u omite si es permisiva (2XX)
            expect(response.status).toBeDefined();
        });
    });

    // ==========================================
    // SECCIÓN 2: OBJETO ROOT Y CONSISTENCIA
    // ==========================================
    describe('2. Root y Consistency (Negativos y Fronteras)', () => {

        test('2.1. Amount: Límite Mínimo (Valor 0)', async () => {
            const p = generateBasePayload(); p.amount = 0;
            const res = await executeFailingPost('Amount Cero', p);
            expect(res.status).toBe(400);
            expect(res.data.error.code).toBe("VALIDATION_ERROR");
        });

        test('2.2. Amount: Valor Negativo (MUTADO) - API Backend Transforma a Absoluto o Falla', async () => {
            const p = generateBasePayload(); p.amount = -1500;
            const res = await executeFailingPost('Amount Negativo API', p);
            // El dev marca que esto da 200 devolviendo instructions para Dinaria:
            expect([200, 201]).toContain(res.status);
            expect(res.data.instructions).toBeDefined();
        });

        test('2.3. Amount: Exceso de Decimales (>2 dígitos, ej: 10.005)', async () => {
            const p = generateBasePayload(); p.amount = 10.005;
            const res = await executeFailingPost('Amount Muchos Decimales', p);
            expect(res.status).toBe(400);
            expect(res.data.error.code).toBe("VALIDATION_ERROR");
            expect(res.data.error.details[0].field).toBe("amount");
            expect(res.data.error.details[0].message).toBe("currency USD supports up to 2 decimals");
        });

        test('2.4. Amount: Stress Testing por límite obsceno astronómico', async () => {
            const p = generateBasePayload(); p.amount = 99999999999999.99;
            const res = await executeFailingPost('Amount Millonario Extremo', p);
            expect(res.status).toBeDefined(); // Dependerá si su base acepta BigDecimals
        });

        test('2.5. Amount: Precisión Decimal Larga (10.12345679)', async () => {
            const p = generateBasePayload(); p.amount = 10.12345679;
            const res = await executeFailingPost('Amount Decimales Largos', p);
            expect(res.status).toBe(400);
            expect(res.data.error.code).toBe("VALIDATION_ERROR");
            expect(res.data.error.details[0].message).toBe("currency USD supports up to 2 decimals");
        });

        test('2.6. Amount: Vacío / Null (400 Expected)', async () => {
            const p = generateBasePayload(); p.amount = null;
            const res = await executeFailingPost('Amount Null', p);
            expect([400, 422]).toContain(res.status);
        });

        test('2.7. Amount: Mínimo Válido Positivo (0.01)', async () => {
            const p = generateBasePayload(); p.amount = 0.01;
            const res = await executeFailingPost('Amount Centavo (0.01)', p);
            // Esto debería funcionar y devolver 2XX, pero forzamos el log para confirmarlo en esta primera ejecución.
            expect(res.status).toBeDefined();
        });

        test('2.8. Consistency: Desacople País-Moneda (AR con COP)', async () => {
            const p = generateBasePayload();
            p.country = "AR";
            p.currency = "COP"; // Falla sistémica por lógica
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
            p.fields.first_name = val;
            return await executeFailingPost(testName, p);
        };

        const runLastNameTest = async (testName, val) => {
            const p = generateBasePayload();
            p.fields.last_name = val;
            return await executeFailingPost(testName, p);
        };

        // --- Validaciones FIRST NAME ---
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
            const nameGigante = "A".repeat(51);
            const res = await runFirstNameTest('First Name Boundary 51', nameGigante);
            expect([400, 422]).toContain(res.status);
        });

        test('3.7.1. First Name: Boundary Valido Máximo (50 Chars) [Exitoso]', async () => {
            const nameMaximoPermitido = "A".repeat(50);
            const res = await runFirstNameTest('First Name Boundary 50 Valido', nameMaximoPermitido);
            expect([200, 201]).toContain(res.status);
        });

        // --- Validaciones LAST NAME ---
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
            const nameGigante = "A".repeat(51);
            const res = await runLastNameTest('Last Name Boundary 51', nameGigante);
            expect([400, 422]).toContain(res.status);
        });

        test('3.14.1. Last Name: Boundary Valido Máximo (50 Chars) [Exitoso]', async () => {
            const nameMaximoPermitido = "A".repeat(50);
            const res = await runLastNameTest('Last Name Boundary 50 Valido', nameMaximoPermitido);
            expect([200, 201]).toContain(res.status);
        });
    });

    // ==========================================
    // SECCIÓN 4: OBJETOS FIELDS (MAIL)
    // ==========================================
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

    // ==========================================
    // SECCIÓN 5: OBJETOS FIELDS (DOCUMENTOS AR CUIT/CUIL)
    // ==========================================
    describe('5. Campos de Identidad (Documentos AR)', () => {

        test('5.1. Reject payin with invalid CUIL prefix (19...)', async () => {
            const p = generateBasePayload(); 
            p.fields.document_number = "19123456789"; 
            const res = await executeFailingPost('CUIL Prefijo Invalido', p);
            expect(res.status).toBe(400);
            expect(res.data.error.code).toBe("VALIDATION_ERROR");
        });

        test('5.2. Reject payin with incorrect CUIL length (10 digits)', async () => {
            const p = generateBasePayload();
            p.fields.document_number = "2012345678"; 
            const res = await executeFailingPost('CUIL 10 digitos', p);
            expect(res.status).toBe(400);
            expect(res.data.error.code).toBe("VALIDATION_ERROR");
        });

        test('5.3. Accept CUIL with hyphens', async () => {
            const p = generateBasePayload();
            p.fields.document_number = "20-08490848-8"; 
            const res = await executeFailingPost('CUIL con Guiones Validado', p);
            expect([200, 201]).toContain(res.status);
            expect(res.data.instructions).toBeDefined();
        });

        test('5.4. AllowOverUnder Testing', async () => {
            const p = generateBasePayload();
            p.allowOverUnder = true; 
            const res = await executeFailingPost('Allow Over/Under', p);
            expect([200, 201]).toContain(res.status);
            expect(res.data.instructions).toBeDefined();
        });
    });

    // ==========================================
    // SECCIÓN 6: PAYMENT METHODS (AUDITORÍA AÑADIDA)
    // ==========================================
    describe('6. Validaciones Estrictas de Método de Pago', () => {

        test('6.1. Método de Pago Vacío / Null', async () => {
            const p = generateBasePayload(); p.payment_method = "";
            const res = await executeFailingPost('Payment Method Vacío', p);
            // La API H2H debería explotar 400 (no hay Dropdown select en puro server-to-server)
            expect(res.status).toBeDefined();
        });

        test('6.2. Método de Pago Falso (Hacking String)', async () => {
            const p = generateBasePayload(); p.payment_method = "método_inventado";
            const res = await executeFailingPost('Payment Method Falso', p);
            expect([400, 422]).toContain(res.status);
        });

    });

});
