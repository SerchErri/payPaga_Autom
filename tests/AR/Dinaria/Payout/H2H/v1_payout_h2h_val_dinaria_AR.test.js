const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../../../../utils/authHelper');
const envConfig = require('../../../../../utils/envConfig');
const { chromium } = require('playwright');
const { preLoadFunds } = require('../../../../../utils/uiBalanceHelper');
const AuditLogger = require('../../../../../utils/auditLogger');

describe(`[E2E H2H] V1 Payout Validaciones Dinaria AR: API Pura con Matemáticas [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    let token = '';
    let auditLog;

    beforeAll(async () => {
        auditLog = new AuditLogger('V1_Payout_H2H_Val_Dinaria_AR');
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
            country_code: overrides.country !== undefined ? overrides.country : 'AR', 
            currency: overrides.currency !== undefined ? overrides.currency : 'ARS', 
            payment_method_code: overrides.payment_method !== undefined ? overrides.payment_method : 'cvu',
            transaction: {
                beneficiary: {
                    first_name: 'Sergio', 
                    last_name: 'Test', 
                    document_number: '20275105792', 
                    account_number: '0070327530004025541644',
                    ...fieldsOverrides
                },
                transaction_data: {
                    transaction_total: overrides.amount !== undefined ? overrides.amount : 1000.00,
                    merchant_transaction_reference: `H2H-Trx-${Date.now()}-${Math.floor(Math.random()*1000)}`
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
            auditLog.logTestStart(`[TEST] Seguridad: Token Falso Rechazado`);
            auditLog.logTest('Seguridad', 'Seguridad: Token Falso Rechazado', payoutUrl, payload, response.status, response.data, true);
            expect(response.status).toBe(401);
        });

        test('1.2. Root Consistency: Inconsistent Country/Currency (AR - COP)', async () => {
            const p = buildPayload({ country: "AR", currency: "COP" });
            const res = await executePayout('TC-02', 'Root: Inconsistent Country/Currency (AR-COP)', p);
            expect([400, 422]).toContain(res.status);
        });
        
        test('1.3. Payment Method: Invalid Method (Hacking String)', async () => {
            const p = buildPayload({ payment_method: "tarjeta_falsa" });
            const res = await executePayout('TC-03', 'Payment Method: Invalid String', p);
            expect([400, 422]).toContain(res.status);
        });
        
        test('1.4. Payment Method: Empty / Null', async () => {
            const p = buildPayload({ payment_method: "" });
            const res = await executePayout('TC-04', 'Payment Method: Empty', p);
            expect([400, 422]).toContain(res.status);
        });
    });

    // ==========================================
    // SECCIÓN 1.5: CAMPOS ROOT ESTRUCTURALES
    // ==========================================
    describe('1.5 Root Structural Validations', () => {
        // --- Country & Currency ---
        test('Reject missing country', async () => await testRejection('TC-05', 'Country: Missing', buildPayload({ country: "" }), 'country'));
        test('Reject invalid country format (ARG)', async () => await testRejection('TC-06', 'Country: Invalid Format ARG', buildPayload({ country: "ARG" }), 'country'));
        
        test('Reject missing currency', async () => await testRejection('TC-07', 'Currency: Missing', buildPayload({ currency: "" }), 'currency'));
        test('Reject invalid currency format (PESOS)', async () => await testRejection('TC-08', 'Currency: Invalid Format PESOS', buildPayload({ currency: "PESOS" }), 'currency'));
    });

    // ==========================================
    // SECCIÓN 2: OBJETO ROOT Y CONSISTENCIA
    // ==========================================
    describe('2. Specific Segment Validations', () => {
        describe('2.1 Segment: First Name', () => {
            test('Reject missing first_name', async () => await testRejection('TC-09', 'First Name: Missing', buildPayload({}, { first_name: "" }), 'first_name'));
            test('Reject first_name exceeding max length', async () => await testRejection('TC-10', 'First Name: Max Length Exceeded', buildPayload({}, { first_name: "a".repeat(100) }), 'first_name'));
            test('Reject first_name numeric', async () => await testRejection('TC-11', 'First Name: Numeric', buildPayload({}, { first_name: "Sergio123" }), 'first_name'));
            test('Reject first_name invalid symbols (XSS)', async () => await testRejection('TC-12', 'First Name: XSS Injection', buildPayload({}, { first_name: "<script>" }), 'first_name'));
            
            test('Reject first_name 1 character (Short Length)', async () => await testRejection('TC-13', 'First Name: Short Length (1 Char)', buildPayload({}, { first_name: "A" }), 'first_name'));
            test('Accept first_name 2 characters (Valid Short)', async () => {
                const res = await executePayout('TC-14', 'First Name: Valid Short (2 Chars)', buildPayload({}, { first_name: "Jo" }), [200, 201, 202]);
                expect(res.status).toBeGreaterThanOrEqual(200);
            });
            test('Accept first_name strange allowed characters (Spaces, Hyphens, Diacritics)', async () => {
                const res = await executePayout('TC-15', 'First Name: Complex Allowed Characters', buildPayload({}, { first_name: "José-María d'Artagnan" }), [200, 201, 202]);
                expect(res.status).toBeGreaterThanOrEqual(200);
            });
        });

        describe('2.2 Segment: Last Name', () => {
            test('Reject missing last_name', async () => await testRejection('TC-16', 'Missing Last Name', buildPayload({}, { last_name: "" }), 'last_name'));
            test('Reject last_name exceeding max length', async () => await testRejection('TC-17', 'Max Length Last Name', buildPayload({}, { last_name: "b".repeat(100) }), 'last_name'));
            test('Reject last_name numeric', async () => await testRejection('TC-18', 'Numeric Last Name', buildPayload({}, { last_name: "Gomez8" }), 'last_name'));
            test('Reject last_name invalid symbols (XSS)', async () => await testRejection('TC-19', 'XSS Last Name', buildPayload({}, { last_name: "Gomez;" }), 'last_name'));
            
            test('Reject last_name 1 character (Short Length)', async () => await testRejection('TC-20', 'Short Last Name', buildPayload({}, { last_name: "B" }), 'last_name'));
            test('Accept last_name 2 characters (Valid Short)', async () => {
                const res = await executePayout('TC-21', 'Valid Short Last Name', buildPayload({}, { last_name: "De" }), [200, 201, 202]);
                expect(res.status).toBeGreaterThanOrEqual(200);
            });
            test('Accept last_name strange allowed characters (Spaces, Hyphens, Diacritics)', async () => {
                const res = await executePayout('TC-22', 'Complex Last Name', buildPayload({}, { last_name: "O'Connor López-García" }), [200, 201, 202]);
                expect(res.status).toBeGreaterThanOrEqual(200);
            });
        });

        describe('2.3 Segment: Document Number (CUIT/CUIL BCRA)', () => {
            test('Reject missing document_number', async () => await testRejection('TC-23', 'Document Number: Missing', buildPayload({}, { document_number: "" }), 'document_number'));
            
            test('Reject payout with invalid CUIL prefix (19...)', async () => {
                const res = await executePayout('TC-24', 'Document Number: Invalid CUIL Prefix (19)', buildPayload({}, { document_number: "19123456789" }), 400);
                expect(res.resText).toMatch(/prefix|format|valid/i);
            });

            test('Reject payout with incorrect CUIL length (10 digits instead of 11)', async () => {
                const res = await executePayout('TC-25', 'Document Number: Invalid Length (10 digits)', buildPayload({}, { document_number: "2012345678" }), 400);
                expect(res.resText).toMatch(/length|format|11/i);
            });
            
            test('Accept CUIL with hyphens (Happy Path Format)', async () => { 
                const res = await executePayout('TC-26', 'Document Number: Valid CUIL with Hyphens', buildPayload({}, { document_number: "20-27510579-2" }), [200, 201, 202]);
                expect(res.status).toBeGreaterThanOrEqual(200);
            });
            
            test('Reject CUIL con caracteres alfabeticos', async () => await testRejection('TC-27', 'Document Number: Alphabetic Characters', buildPayload({}, { document_number: "20X84908488" }), 'document_number'));
        });

        describe('2.4 Segment: Account Number (CBU/CVU BCRA Math Strict)', () => {
            test('Reject missing account_number', async () => await testRejection('TC-28', 'Account Number: Missing', buildPayload({}, { account_number: "" }), 'account_number'));
            
            // --- Positive Cases ---
            test('Accept CBU Válido (Tradicional Bancario)', async () => { 
                const res = await executePayout('TC-29', 'Account Number: Valid CBU', buildPayload({}, { account_number: "0070327530004025541644" }), [200, 201, 202]);
                expect(res.status).toBeGreaterThanOrEqual(200);
            });

            test('Accept CVU Válido (Billetera Virtual)', async () => { 
                const res = await executePayout('TC-30', 'Account Number: Valid CVU', buildPayload({}, { account_number: "0000003100009620154382" }), [200, 201, 202]);
                expect(res.status).toBeGreaterThanOrEqual(200);
            });

            // --- Negative Structural Cases ---
            test('Reject payout with invalid CVU/CBU length (21 instead of 22)', async () => {
                const res = await executePayout('TC-31', 'Account Number: Invalid Length (21 digits)', buildPayload({}, { account_number: "123456789012345678901" }), 400);
                expect(res.resText).toMatch(/22/);
            });

            test('Reject payout with CVU not starting with 000', async () => {
                const res = await executePayout('TC-32', 'Account Number: Invalid CVU Prefix (No 000)', buildPayload({}, { account_number: "1234567890123456789012" }), 400);
                expect(res.resText).toMatch(/000/);
            });

            // --- BCRA Algorithm Negative Cases (Check Digits) ---
            test('Reject CVU Inválido (Falla en el Check Digit final)', async () => {
                const res = await executePayout('TC-33', 'Account Number: Invalid CVU Final Check Digit', buildPayload({}, { account_number: "0000003100009620154389" }), 400);
                expect(res.resText).toMatch(/digit|account/i);
            });

            test('Reject CBU Inválido (Falla en el Check Digit final)', async () => {
                const res = await executePayout('TC-34', 'Account Number: Invalid CBU Final Check Digit', buildPayload({}, { account_number: "0070327530004025541649" }), 400);
                expect(res.resText).toMatch(/digit|account/i);
            });

            test('Reject payout with invalid CVU check digit block 1', async () => {
                const res = await executePayout('TC-35', 'Account Number: Invalid CVU Block 1 Check Digit', buildPayload({}, { account_number: "0000003900062244154712" }), 400);
                expect(res.resText).toMatch(/position 8/i);
            });

            test('Reject payout with invalid CVU check digit block 2', async () => {
                const res = await executePayout('TC-36', 'Account Number: Invalid CVU Block 2 Check Digit', buildPayload({}, { account_number: "0000003100062244154719" }), 400);
                expect(res.resText).toMatch(/position 22/i);
            });
        });
    });

    describe('3. Mathematical, Amount & Balance Validations', () => {
        test('Reject missing amount (null/empty)', async () => {
            const res = await executePayout('TC-37', 'Amount is Missing', buildPayload({ amount: null }), 400);
            expect(res.resText).toMatch(/amount/i);
        });

        test('Reject amount passed as String', async () => {
            const res = await executePayout('TC-38', 'Amount as String', buildPayload({ amount: "1000.00" }), 400);
            expect(res.status).toBeDefined();
        });

        test('Reject payout with amount == 0', async () => {
            const res = await executePayout('TC-39', 'Amount is 0', buildPayload({ amount: 0 }), 400);
            expect(res.resText).toMatch(/amount|greater/i);
        });

        test('Amount < 0 (Negative) is absolute - should be accepted', async () => {
            const res = await executePayout('TC-40', 'Amount is Negative (Absolute)', buildPayload({ amount: -10.5 }), [200, 201, 202]);
            expect(res.status).toBeGreaterThanOrEqual(200);
        });
    });

    describe('4. Full Mathematical Flow (Balance Auditing)', () => {
        test('Strict verification of balance, creation and mathematical deduction post-approval', async () => {
            // A) GET PREVIOUS BALANCES
            const preBalance = await getMerchantBalance(token);

            // B) POST PAYOUT HAPPY PATH
            const payload = buildPayload();
            const { status, data } = await executePayout('TC-41', 'Happy Path Payout', payload, [200, 201, 202]);
            const txId = data.id || data.transaction_id || data.merchant_transaction_reference || (data.details && data.details.transaction_processed && data.details.transaction_processed.transaction_id);
            expect(txId).toBeDefined();

            // C) GET SUBSEQUENT BALANCES (Ensure immediate deduction via PENDING state)
            await new Promise(r => setTimeout(r, 2000));
            const postBalance = await getMerchantBalance(token);

            // D) MATH
            const targetMonto = payload.transaction.transaction_data.transaction_total;
            const diff = preBalance.available - postBalance.available;
            
            if(allure && allure.attachment) {
                await allure.attachment(`🧮 Mathematical Comparison`, JSON.stringify({
                    "Initial Balance (available)": preBalance.available,
                    "Processed Amount": targetMonto,
                    "Final Balance Detected": postBalance.available,
                    "Actual Difference Detected": diff
                }, null, 2), 'application/json');
            }

            expect(postBalance.available).toBeLessThan(preBalance.available);
        });
    });
});
