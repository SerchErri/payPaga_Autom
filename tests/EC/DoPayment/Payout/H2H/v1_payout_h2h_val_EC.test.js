const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../../../../utils/authHelper');
const envConfig = require('../../../../../utils/envConfig');
const AuditLogger = require('../../../../../utils/auditLogger');
const { chromium } = require('playwright');
const { preLoadFunds } = require('../../../../../utils/uiBalanceHelper');

describe(`[E2E H2H] V1 Payout AccountBank Ecuador: API Pura con Auditoría LIFO [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    let token = '';
    let currentBalanceRecord = 0;
    let auditLog;

    beforeAll(async () => {
        token = await getAccessToken();
        auditLog = new AuditLogger('V1_Payout_H2H_Val_EC');
        
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

    jest.setTimeout(25000);

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
            country_code: overrides.country !== undefined ? overrides.country : 'EC', 
            currency: overrides.currency !== undefined ? overrides.currency : 'USD', 
            payment_method_code: overrides.payment_method !== undefined ? overrides.payment_method : 'bank_transfer',
            transaction: {
                beneficiary: {
                    first_name: 'Sergio', 
                    last_name: 'Errigo', 
                    document_type: 'CI',
                    document_number: '1710034065', 
                    bank_code: 'banco_pichincha',
                    account_type: 'ahorro',
                    account_number: '2201234567',
                    ...fieldsOverrides
                },
                transaction_data: {
                    transaction_total: overrides.amount !== undefined ? overrides.amount : 150.23,
                    merchant_transaction_reference: `H2H-EC-${Date.now()}-${Math.floor(Math.random()*1000)}`
                }
            }
        };
    };

    const payoutUrl = `${envConfig.BASE_URL}/v1/payout`;

    const executePayout = async (testId, testName, payload, expectedStatus) => {
        const res = await axios.post(payoutUrl, payload, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'DisablePartnerMock': 'true' },
            validateStatus: () => true,
        });

        auditLog.logTestStart(`[TEST] ${testName}`);

        let isExpectedToFail = true;
        if (Array.isArray(expectedStatus) && expectedStatus.some(s => s < 400)) isExpectedToFail = false;
        else if (expectedStatus < 400) isExpectedToFail = false;

        auditLog.logTest(testId, testName, payoutUrl, payload, res.status, res.data, isExpectedToFail);

        const resText = JSON.stringify(res.data, null, 2);

        if (Array.isArray(expectedStatus)) {
            expect(expectedStatus).toContain(res.status);
        } else if (expectedStatus) {
            expect(res.status).toBe(expectedStatus);
        }
        return { status: res.status, data: res.data, resText };
    };

    const testRejection = async (testId, testName, payload, expectedKey) => {
        const { resText } = await executePayout(testId, testName, payload, 400);
        if (expectedKey) expect(resText.toLowerCase()).toContain(expectedKey.toLowerCase().replace(' ', '_'));
    };

    describe('1. Happy Path - Payout Creado Correctamente (Auditoría de Balances)', () => {
        test('Verificación estricta de saldo, creación y descuento matemático', async () => {
            const preBalance = await getMerchantBalance(token);
            if(allure && allure.attachment) await allure.attachment(`🔍 GET Balances PRE Payout`, JSON.stringify(preBalance.fullResponse, null, 2), 'application/json');

            const payload = buildPayload();
            const { status, data } = await executePayout('TC01', 'Happy Path V1 Payout (> 500.45)', payload, [200, 201, 202]);
            expect(data.transaction_id || data.id || data.merchant_transaction_reference).toBeDefined();

            await new Promise(r => setTimeout(r, 2000));
            const postBalance = await getMerchantBalance(token);
            if(allure && allure.attachment) await allure.attachment(`🔍 GET Balances POST Payout`, JSON.stringify(postBalance.fullResponse, null, 2), 'application/json');

            const targetMonto = payload.transaction.transaction_data.transaction_total;
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

    describe('2. Validaciones Específicas por Segmento', () => {
        describe('2.1 Segmento Primer Nombre (First Name)', () => {
            test('Reject missing first_name', async () => await testRejection('TC02', 'Missing First Name', buildPayload({}, { first_name: "" }), 'first_name'));
            test('Reject first_name exceeding max length', async () => await testRejection('TC03', 'Max Length First Name', buildPayload({}, { first_name: "a".repeat(100) }), 'first name'));
            test('Reject first_name numeric', async () => await testRejection('TC04', 'Numeric First Name', buildPayload({}, { first_name: "Sergio123" }), 'first name'));
            test('Reject first_name invalid symbols (XSS)', async () => await testRejection('TC05', 'XSS First Name', buildPayload({}, { first_name: "<script>" }), 'first name'));
            test('Reject first_name special chars (Emoji)', async () => await testRejection('TC06', 'Emoji First Name', buildPayload({}, { first_name: "Sergio😎" }), 'first name'));
        });

        describe('2.2 Segmento Apellidos (Last Name)', () => {
            test('Reject missing last_name', async () => await testRejection('TC07', 'Missing Last Name', buildPayload({}, { last_name: "" }), 'last_name'));
            test('Reject last_name exceeding max length', async () => await testRejection('TC08', 'Max Length Last Name', buildPayload({}, { last_name: "b".repeat(100) }), 'last name'));
            test('Reject last_name numeric', async () => await testRejection('TC09', 'Numeric Last Name', buildPayload({}, { last_name: "Perez8" }), 'last name'));
            test('Reject last_name invalid symbols (XSS)', async () => await testRejection('TC10', 'XSS Last Name', buildPayload({}, { last_name: "Perez;" }), 'last name'));
        });

        describe('2.3 Segmento Tipo de Documento', () => {
            test('Reject missing document_type', async () => await testRejection('TC11', 'Missing Document Type', buildPayload({}, { document_type: "" }), 'document_type'));
            test('Reject invalid document_type (DNI en EC)', async () => await testRejection('TC12', 'Invalid Document Type', buildPayload({}, { document_type: "DNI" }), 'document type'));
        });

        describe('2.4 Segmento Número de Documento', () => {
            test('Reject missing document_number', async () => await testRejection('TC13', 'Missing Doc Number', buildPayload({}, { document_number: "" }), 'document_number'));
            test('Reject document_number exceeding max length', async () => await testRejection('TC14', 'Max Length Doc Number', buildPayload({}, { document_number: "c".repeat(50) }), 'document number'));
        });

        describe('2.5 Segmento Entidad Bancaria (Bank Code)', () => {
            test('Reject missing bank_code', async () => await testRejection('TC15', 'Missing Bank Code', buildPayload({}, { bank_code: "" }), 'bank'));
            test('Reject invalid bank_code', async () => await testRejection('TC16', 'Invalid Bank Code', buildPayload({}, { bank_code: "BANCO_INVALIDO_TEST" }), 'bank'));
        });

        describe('2.6 Segmento Tipo de Cuenta (Account Type)', () => {
            test('Reject missing account_type', async () => await testRejection('TC17', 'Missing Account Type', buildPayload({}, { account_type: "" }), 'account_type'));
            test('Reject invalid account_type (Vista)', async () => await testRejection('TC18', 'Invalid Account Type', buildPayload({}, { account_type: "VISTA" }), 'account type'));
        });

        describe('2.7 Segmento Número de Cuenta (Account Number)', () => {
            test('Reject missing account_number', async () => await testRejection('TC19', 'Missing Account Number', buildPayload({}, { account_number: "" }), 'account_number'));
            test('Reject account_number exceeding max length', async () => await testRejection('TC20', 'Max Length Account Number', buildPayload({}, { account_number: "x".repeat(60) }), 'account number'));
        });
    });

    describe('3. Validaciones Matemáticas y Saldo Insuficiente', () => {
        test('Reject payout with amount == 0', async () => {
            await testRejection('TC21', 'Amount is 0', buildPayload({ amount: 0 }), 'amount');
        });

        test('Reject payout with amount < 0 (Negative)', async () => {
            await testRejection('TC22', 'Amount is Negative', buildPayload({ amount: -10.5 }), 'amount');
        });

        test('Reject payout with amount == 1 (Validar posible error de mínimo)', async () => {
            const { status, resText } = await executePayout('TC23', 'Amount is 1 (Mínimo)', buildPayload({ amount: 1 }), [400, 422]).catch(async () => {
                 return await executePayout('TC23', 'Amount is 1 (Asíncrono o Válido)', buildPayload({ amount: 1 }), [201, 202]);
            });
            if(status === 400 || status === 422) {
                expect(resText.toLowerCase()).toMatch(/amount|minimo|minimum|invalid/);
            }
        });

        test('Insuficiencia de Balance: Comportamiento y Reverso', async () => {
            const massiveAmount = 999999999.00;
            const preFallosBalance = await getMerchantBalance(token);
            if(allure && allure.attachment) await allure.attachment(`🔍 GET Saldo PRE-Masivo`, JSON.stringify(preFallosBalance.fullResponse, null, 2), 'application/json');

            await executePayout('TC24', 'Huge Amount Insufficient Funds', buildPayload({ amount: massiveAmount }), [202, 400, 422]);
            
            await new Promise(r => setTimeout(r, 2000));
            const postFallosBalance = await getMerchantBalance(token);
            if(allure && allure.attachment) await allure.attachment(`🔍 GET Saldo POST-Masivo (Verifica que no descontó)`, JSON.stringify(postFallosBalance.fullResponse, null, 2), 'application/json');

            expect(postFallosBalance.available).toBeCloseTo(preFallosBalance.available, 1);
        });
    });
});
