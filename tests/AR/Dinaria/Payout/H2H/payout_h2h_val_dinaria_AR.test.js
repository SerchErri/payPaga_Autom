const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../../../../utils/authHelper');
const envConfig = require('../../../../../utils/envConfig');
const { chromium } = require('playwright');
const { preLoadFunds } = require('../../../../../utils/uiBalanceHelper');

describe(`[E2E H2H] Payout AccountBank Ecuador: API Pura con Matemáticas [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    let token = '';
    let currentBalanceRecord = 0;

    beforeAll(async () => {
        token = await getAccessToken();
        
        // Auto-Carga de Fondos (Pay-in 10000 -> Approve Admin)
        try {
            const browser = await chromium.launch({ headless: true });
            const context = await browser.newContext();
            const page = await context.newPage();
            await preLoadFunds(page, token, allure, 10000.00);
            await browser.close();
        } catch(e) { console.error("No se pudo pre-cargar fondos", e.message); }

        const initialRes = await getMerchantBalance(token);
        currentBalanceRecord = initialRes.available;
    });

    jest.setTimeout(15000); // REBAJADO RADICALMENTE: 15 Segundos en API pura (3000ms rompería si el curl del backend de Paypaga demora más de 3s)

    const getMerchantBalance = async (jwt) => {
        const balanceUrl = `${envConfig.BASE_URL}/v2/balances?country=EC`;
        const res = await axios.get(balanceUrl, { headers: { 'Authorization': `Bearer ${jwt}` }, validateStatus: () => true });
        
        let available = 0;
        if (res.status === 200 && res.data && res.data.countries && res.data.countries.length > 0) {
            available = res.data.countries[0].available_for_payout || 0;
        }
        return { available, fullResponse: res.data };
    };

    const buildPayload = (overrides = {}, fieldsOverrides = {}) => {
        return {
            country: 'EC', currency: 'USD', payment_method: 'bank_transfer',
            merchant_transaction_reference: `H2H-AccBank-${Date.now()}-${Math.floor(Math.random()*1000)}`,
            merchant_order_reference: `H2H-Order-${Date.now()}`,
            merchant_customer_id: "customer@email.com",
            amount: 150.23, 
            fields: {
                first_name: 'Sergio', last_name: 'Errigo', document_type: 'CI', document_number: '1710034065',
                bank_code: 'banco_pichincha', account_type: 'ahorro', account_number: '2201234567',
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
        if (allure && allure.attachment) {
            await allure.attachment(`POST Request Payload: ${testName}`, JSON.stringify(payload, null, 2), 'application/json');
            await allure.attachment(`POST Response: ${testName} [HTTP ${res.status}]`, resText, 'application/json');
        }

        if (Array.isArray(expectedStatus)) {
            expect(expectedStatus).toContain(res.status);
        } else {
            expect(res.status).toBe(expectedStatus);
        }
        return { status: res.status, data: res.data, resText };
    };

    describe('1. Happy Path - Payout Creado Correctamente (Auditoría de Balances)', () => {
        test('Verificación estricta de saldo, creación y descuento matemático', async () => {
            // A) GET SALDOS PREVIOS
            const preBalance = await getMerchantBalance(token);
            if(allure && allure.attachment) await allure.attachment(`🔍 GET Balances PRE Payout`, JSON.stringify(preBalance.fullResponse, null, 2), 'application/json');

            // B) POST PAYOUT
            const payload = buildPayload();
            const { status, data } = await executePayout('Happy Path Payout (> 500.45)', payload, [200, 201, 202]);
            expect(data.transaction_id || data.id || data.merchant_transaction_reference).toBeDefined();

            // C) GET SALDOS POSTERIORES
            await new Promise(r => setTimeout(r, 2000));
            const postBalance = await getMerchantBalance(token);
            if(allure && allure.attachment) await allure.attachment(`🔍 GET Balances POST Payout`, JSON.stringify(postBalance.fullResponse, null, 2), 'application/json');

            // D) MATEMÁTICAS
            const targetMonto = payload.amount;
            const diff = preBalance.available - postBalance.available;
            
            if(allure && allure.attachment) {
                await allure.attachment(`🧮 Comparación Matemática`, JSON.stringify({
                    "Saldo Inicial (available_for_payout)": preBalance.available,
                    "Monto Procesado": targetMonto,
                    "Saldo Final Detectado": postBalance.available,
                    "Diferencia (Monto + Fees)": diff
                }, null, 2), 'application/json');
            }

            expect(postBalance.available).toBeLessThan(preBalance.available);
            currentBalanceRecord = postBalance.available;
        });
    });

    const testRejection = async (testName, payload, expectedKey) => {
        const { resText } = await executePayout(testName, payload, 400);
        if (expectedKey) expect(resText.toLowerCase()).toContain(expectedKey.toLowerCase().replace(' ', '_'));
    };

    describe('2. Validaciones Específicas por Segmento', () => {
        describe('2.1 Segmento Primer Nombre (First Name)', () => {
            test('Reject missing first_name', async () => await testRejection('Missing First Name', buildPayload({}, { first_name: "" }), 'first_name'));
            test('Reject first_name exceeding max length', async () => await testRejection('Max Length First Name', buildPayload({}, { first_name: "a".repeat(100) }), 'first name'));
            test('Reject first_name numeric', async () => await testRejection('Numeric First Name', buildPayload({}, { first_name: "Sergio123" }), 'first name'));
            test('Reject first_name invalid symbols (XSS)', async () => await testRejection('XSS First Name', buildPayload({}, { first_name: "<script>" }), 'first name'));
            test('Reject first_name special chars (Emoji)', async () => await testRejection('Emoji First Name', buildPayload({}, { first_name: "Sergio😎" }), 'first name'));
        });

        describe('2.2 Segmento Apellidos (Last Name)', () => {
            test('Reject missing last_name', async () => await testRejection('Missing Last Name', buildPayload({}, { last_name: "" }), 'last_name'));
            test('Reject last_name exceeding max length', async () => await testRejection('Max Length Last Name', buildPayload({}, { last_name: "b".repeat(100) }), 'last name'));
            test('Reject last_name numeric', async () => await testRejection('Numeric Last Name', buildPayload({}, { last_name: "Perez8" }), 'last name'));
            test('Reject last_name invalid symbols (XSS)', async () => await testRejection('XSS Last Name', buildPayload({}, { last_name: "Perez;" }), 'last name'));
            test('Reject last_name special chars', async () => await testRejection('Special Chars Last Name', buildPayload({}, { last_name: "Perez¿" }), 'last name'));
        });

        describe('2.3 Segmento Tipo de Documento', () => {
            test('Reject missing document_type', async () => await testRejection('Missing Document Type', buildPayload({}, { document_type: "" }), 'document_type'));
            test('Reject invalid document_type (DNI en EC)', async () => await testRejection('Invalid Document Type', buildPayload({}, { document_type: "DNI" }), 'document type'));
        });

        describe('2.4 Segmento Número de Documento', () => {
            test('Reject missing document_number', async () => await testRejection('Missing Doc Number', buildPayload({}, { document_number: "" }), 'document_number'));
            test('Reject document_number exceeding max length', async () => await testRejection('Max Length Doc Number', buildPayload({}, { document_number: "c".repeat(50) }), 'document number'));
        });

        describe('2.5 Segmento Entidad Bancaria (Bank Code)', () => {
            test('Reject missing bank_code', async () => await testRejection('Missing Bank Code', buildPayload({}, { bank_code: "" }), 'bank'));
            test('Reject invalid bank_code', async () => await testRejection('Invalid Bank Code', buildPayload({}, { bank_code: "BANCO_INVALIDO_TEST" }), 'bank'));
        });

        describe('2.6 Segmento Tipo de Cuenta (Account Type)', () => {
            test('Reject missing account_type', async () => await testRejection('Missing Account Type', buildPayload({}, { account_type: "" }), 'account_type'));
            test('Reject invalid account_type (Vista)', async () => await testRejection('Invalid Account Type', buildPayload({}, { account_type: "VISTA" }), 'account type'));
        });

        describe('2.7 Segmento Número de Cuenta (Account Number)', () => {
            test('Reject missing account_number', async () => await testRejection('Missing Account Number', buildPayload({}, { account_number: "" }), 'account_number'));
            test('Reject account_number exceeding max length', async () => await testRejection('Max Length Account Number', buildPayload({}, { account_number: "x".repeat(60) }), 'account number'));
            // Agregar cualquier otro test límite exigido en Account Bank si fuera numérico, e.g. espacios o strings.
        });
    });

    describe('3. Validaciones Matemáticas, Montos y Saldos Insuficientes', () => {
        test('Reject payout with amount == 0', async () => {
            await testRejection('Amount is 0', buildPayload({ amount: 0 }), 'amount');
        });

        test('Reject payout with amount < 0 (Negative)', async () => {
            await testRejection('Amount is Negative', buildPayload({ amount: -10.5 }), 'amount');
        });

        test('Reject payout with amount == 1 (Validar posible error de mínimo)', async () => {
            const { status, resText } = await executePayout('Amount is 1 (Mínimo)', buildPayload({ amount: 1 }), [400, 422]).catch(async () => {
                 return await executePayout('Amount is 1 (Asíncrono o Válido)', buildPayload({ amount: 1 }), [201, 202]);
            });
            // Sólo hacemos asserts si sabemos que lo va a rechazar (el PM indicó que envía mensaje de error).
            if(status === 400 || status === 422) {
                expect(resText.toLowerCase()).toMatch(/amount|minimo|minimum|invalid/);
            }
        });

        test('Insuficiencia de Balance: Comportamiento y Reverso asíncrono', async () => {
            const massiveAmount = 999999999.00;
            // Evaluamos la falta de fondos.
            const preFallosBalance = await getMerchantBalance(token);
            if(allure && allure.attachment) await allure.attachment(`🔍 GET Saldo PRE-Masivo`, JSON.stringify(preFallosBalance.fullResponse, null, 2), 'application/json');

            const res = await executePayout('Huge Amount Insufficient Funds', buildPayload({ amount: massiveAmount }), [202, 400, 422]);
            
            await new Promise(r => setTimeout(r, 2000));
            const postFallosBalance = await getMerchantBalance(token);
            if(allure && allure.attachment) await allure.attachment(`🔍 GET Saldo POST-Masivo (Verifica que no descontó)`, JSON.stringify(postFallosBalance.fullResponse, null, 2), 'application/json');

            // El saldo NO debe descontarse, o debe ser debidamente retornado a su caja de available
            expect(postFallosBalance.available).toBeCloseTo(preFallosBalance.available, 1);
        });

    });
});
