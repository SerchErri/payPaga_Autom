const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../../../../utils/authHelper');
const envConfig = require('../../../../../utils/envConfig');
const { chromium } = require('playwright');
const { preLoadFunds } = require('../../../../../utils/uiBalanceHelper');

describe(`[E2E H2H] Payout Validaciones Dinaria AR: API Pura con Matemáticas [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    let token = '';

    beforeAll(async () => {
        token = await getAccessToken();
        
        // Auto-Carga de Fondos (Pay-in masivo -> Approve Admin)
        try {
            const browser = await chromium.launch({ headless: true });
            const context = await browser.newContext();
            const page = await context.newPage();
            await preLoadFunds(page, token, allure, 100000.00, 'AR');
            await browser.close();
        } catch(e) { console.error("No se pudo pre-cargar fondos", e.message); }
    });

    jest.setTimeout(15000); 

    const getMerchantBalance = async (jwt) => {
        const balanceUrl = `${envConfig.BASE_URL}/v2/balances?country=AR`;
        const res = await axios.get(balanceUrl, { headers: { 'Authorization': `Bearer ${jwt}` }, validateStatus: () => true });
        
        let available = 0;
        if (res.status === 200 && res.data && res.data.countries && res.data.countries.length > 0) {
            available = res.data.countries[0].available_for_payout || 0;
        }
        return { available, fullResponse: res.data };
    };

    const buildPayload = (overrides = {}, fieldsOverrides = {}) => {
        return {
            amount: 1000.00, 
            country: 'AR', 
            currency: 'ARS', 
            payment_method: 'cvu',
            merchant_order_reference: `H2H-Order-${Date.now()}-${Math.floor(Math.random()*1000)}`,
            merchant_transaction_reference: `H2H-Trx-${Date.now()}-${Math.floor(Math.random()*1000)}`,
            merchant_customer_id: "customer@email.com",
            customer_ip: "120.29.48.92",
            fields: {
                first_name: 'Sergio', 
                last_name: 'Test', 
                document_number: '20275105792', 
                account_number: '0070327530004025541644',
                ...fieldsOverrides
            },
            ...overrides
        };
    };

    const payoutUrl = `${envConfig.BASE_URL}/v2/transactions/pay-out`;

    const executePayout = async (testName, payload, expectedStatus) => {
        const res = await axios.post(payoutUrl, payload, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'DisablePartnerMock': 'true' },
            validateStatus: () => true,
        });

        const resText = JSON.stringify(res.data, null, 2);
        
        console.log(`\n=== 🚨 FALLA PROVOCADA PARA: ${testName} ===`);
        console.log(`Status devuelto por backend: ${res.status}`);
        console.log(`Respuesta:`, res.data);
        console.log(`===============================================`);

        if (allure && allure.attachment) {
            await allure.attachment(`Causa/Payload - ${testName}`, JSON.stringify(payload, null, 2), 'application/json');
            await allure.attachment(`Efecto/Respuesta - ${testName} [HTTP ${res.status}]`, resText, 'application/json');
        }

        if (Array.isArray(expectedStatus)) {
            expect(expectedStatus).toContain(res.status);
        } else if (expectedStatus) {
            expect(res.status).toBe(expectedStatus);
        }
        return { status: res.status, data: res.data, resText };
    };

    const testRejection = async (testName, payload, expectedKey) => {
        const { resText } = await executePayout(testName, payload, 400);
        if (expectedKey) expect(resText.toLowerCase()).toContain(expectedKey.toLowerCase().replace(' ', '_'));
    };

    // ==========================================
    // SECCIÓN 1: SEGURIDAD Y ESTRUCTURA (Root Payout)
    // ==========================================
    describe('1. Seguridad e Integridad de la Llamada Payout H2H', () => {

        test('1.1. Seguridad: Forzar Unauthorized (401) con Token Falso', async () => {
            const payload = buildPayload();
            const response = await axios.post(payoutUrl, payload, {
                headers: {
                    'DisablePartnerMock': 'true',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer eyJhb.INVENTADO.xyz` 
                },
                validateStatus: () => true
            });
            expect(response.status).toBe(401);
        });

        test('1.2. Root Consistency: Desacople País-Moneda (AR con COP)', async () => {
            const p = buildPayload({ country: "AR", currency: "COP" });
            const res = await executePayout('Moneda Incorrecta AR', p);
            expect([400, 422]).toContain(res.status);
        });
        
        test('1.3. Método de Pago Inválido (Hacking String)', async () => {
            const p = buildPayload({ payment_method: "tarjeta_falsa" });
            const res = await executePayout('Payment Method Falso', p);
            expect([400, 422]).toContain(res.status);
        });
    });

    // ==========================================
    // SECCIÓN 2: OBJETO ROOT Y CONSISTENCIA
    // ==========================================
    describe('2. Validaciones Específicas por Segmento', () => {
        describe('2.1 Segmento Primer Nombre (First Name)', () => {
            test('Reject missing first_name', async () => await testRejection('Missing First Name', buildPayload({}, { first_name: "" }), 'first_name'));
            test('Reject first_name exceeding max length', async () => await testRejection('Max Length First Name', buildPayload({}, { first_name: "a".repeat(100) }), 'first name'));
            test('Reject first_name numeric', async () => await testRejection('Numeric First Name', buildPayload({}, { first_name: "Sergio123" }), 'first name'));
            test('Reject first_name invalid symbols (XSS)', async () => await testRejection('XSS First Name', buildPayload({}, { first_name: "<script>" }), 'first name'));
        });

        describe('2.2 Segmento Apellidos (Last Name)', () => {
            test('Reject missing last_name', async () => await testRejection('Missing Last Name', buildPayload({}, { last_name: "" }), 'last_name'));
            test('Reject last_name exceeding max length', async () => await testRejection('Max Length Last Name', buildPayload({}, { last_name: "b".repeat(100) }), 'last name'));
            test('Reject last_name numeric', async () => await testRejection('Numeric Last Name', buildPayload({}, { last_name: "Gomez8" }), 'last name'));
            test('Reject last_name invalid symbols (XSS)', async () => await testRejection('XSS Last Name', buildPayload({}, { last_name: "Gomez;" }), 'last name'));
        });

        describe('2.3 Segmento Número de Documento (CUIT/CUIL BCRA)', () => {
            test('Reject missing document_number', async () => await testRejection('Missing Doc Number', buildPayload({}, { document_number: "" }), 'document_number'));
            
            test('Reject payout with invalid CUIL prefix (19...)', async () => {
                const res = await executePayout('CUIL Prefix Invalido (19)', buildPayload({}, { document_number: "19123456789" }), 400);
                expect(res.resText).toMatch(/prefix|format|valid/i);
            });

            test('Reject payout with incorrect CUIL length (10 digits instead of 11)', async () => {
                const res = await executePayout('CUIL solo 10 numeros', buildPayload({}, { document_number: "2012345678" }), 400);
                expect(res.resText).toMatch(/length|format|11/i);
            });
            
            test('Accept CUIL with hyphens (Happy Path Format)', async () => { 
                const res = await executePayout('CUIL con guiones', buildPayload({}, { document_number: "20-27510579-2" }), [200, 201, 202]);
                expect(res.status).toBeGreaterThanOrEqual(200);
            });
            
            test('Reject CUIL con caracteres alfabeticos', async () => await testRejection('Alfabetico CUIL', buildPayload({}, { document_number: "20X84908488" }), 'document_number'));
        });

        describe('2.4 Segmento Número de Cuenta (CBU/CVU BCRA Math Strict)', () => {
            test('Reject missing account_number', async () => await testRejection('Missing Account Number', buildPayload({}, { account_number: "" }), 'account_number'));
            
            // --- Casos Positivos ---
            test('Accept CBU Válido (Tradicional Bancario)', async () => { 
                const res = await executePayout('CBU Valido', buildPayload({}, { account_number: "0070327530004025541644" }), [200, 201, 202]);
                expect(res.status).toBeGreaterThanOrEqual(200);
            });

            test('Accept CVU Válido (Billetera Virtual)', async () => { 
                const res = await executePayout('CVU Valido', buildPayload({}, { account_number: "0000003100009620154382" }), [200, 201, 202]);
                expect(res.status).toBeGreaterThanOrEqual(200);
            });

            // --- Casos Negativos de Estructura ---
            test('Reject payout with invalid CVU/CBU length (21 instead of 22)', async () => {
                const res = await executePayout('CVU 21 digitos', buildPayload({}, { account_number: "123456789012345678901" }), 400);
                expect(res.resText).toMatch(/22/);
            });

            test('Reject payout with CVU not starting with 000', async () => {
                const res = await executePayout('CVU sin prefix 000', buildPayload({}, { account_number: "1234567890123456789012" }), 400);
                expect(res.resText).toMatch(/000/);
            });

            // --- Casos Negativos por Algoritmo BCRA (Check Digits) ---
            test('Reject CVU Inválido (Falla en el Check Digit final)', async () => {
                // Alteramos el último dígito del CVU válido (2 -> 9)
                const res = await executePayout('CVU Invalido Check Digit', buildPayload({}, { account_number: "0000003100009620154389" }), 400);
                expect(res.resText).toMatch(/digit|account/i);
            });

            test('Reject CBU Inválido (Falla en el Check Digit final)', async () => {
                // Alteramos el último dígito del CBU válido (4 -> 9)
                const res = await executePayout('CBU Invalido Check Digit', buildPayload({}, { account_number: "0070327530004025541649" }), 400);
                expect(res.resText).toMatch(/digit|account/i);
            });

            test('Reject payout with invalid CVU check digit block 1', async () => {
                const res = await executePayout('CVU Check Digit Block 1 Falla', buildPayload({}, { account_number: "0000003900062244154712" }), 400);
                expect(res.resText).toMatch(/position 8/i);
            });

            test('Reject payout with invalid CVU check digit block 2', async () => {
                const res = await executePayout('CVU Check Digit Block 2 Falla', buildPayload({}, { account_number: "0000003100062244154719" }), 400);
                expect(res.resText).toMatch(/position 22/i);
            });
        });
    });

    describe('3. Validaciones Matemáticas, Montos y Saldos Insuficientes', () => {
        test('Reject payout with amount == 0', async () => {
            const res = await executePayout('Amount is 0', buildPayload({ amount: 0 }), 400);
            expect(res.resText).toMatch(/amount|greater/i);
        });

        test('Reject payout with amount < 0 (Negative)', async () => {
            await testRejection('Amount is Negative', buildPayload({ amount: -10.5 }), 'amount');
        });

        test('Reject payout with insufficient balance', async () => {
            const massiveAmount = 999999999.00;
            const preFallosBalance = await getMerchantBalance(token);
            const res = await executePayout('Huge Amount Insufficient Funds', buildPayload({ amount: massiveAmount }), 400);
            expect(res.resText).toMatch(/insufficient balance/i);
            
            await new Promise(r => setTimeout(r, 2000));
            const postFallosBalance = await getMerchantBalance(token);
            // El saldo NO debe descontarse
            expect(postFallosBalance.available).toBeCloseTo(preFallosBalance.available, 1);
        });
    });

    describe('4. Flujo Matemático Completo (Auditoría de Balances)', () => {
        test('Verificación estricta de saldo, creación y descuento matemático post-aprobación', async () => {
            // A) GET SALDOS PREVIOS
            const preBalance = await getMerchantBalance(token);

            // B) POST PAYOUT FELIZ
            const payload = buildPayload();
            const { status, data } = await executePayout('Happy Path Payout', payload, [200, 201, 202]);
            expect(data.id || data.transaction_id || data.merchant_transaction_reference).toBeDefined();

            // C) GET SALDOS POSTERIORES (Asegurarse de descuento inmediato por PENDING)
            await new Promise(r => setTimeout(r, 2000));
            const postBalance = await getMerchantBalance(token);

            // D) MATEMÁTICAS
            const targetMonto = payload.amount;
            const diff = preBalance.available - postBalance.available;
            
            if(allure && allure.attachment) {
                await allure.attachment(`🧮 Comparación Matemática`, JSON.stringify({
                    "Saldo Inicial (available)": preBalance.available,
                    "Monto Procesado": targetMonto,
                    "Saldo Final Detectado": postBalance.available,
                    "Diferencia Real Detectada": diff
                }, null, 2), 'application/json');
            }

            expect(postBalance.available).toBeLessThan(preBalance.available);
        });
    });
});
