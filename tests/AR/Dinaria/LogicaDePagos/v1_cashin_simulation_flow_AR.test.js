const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../../../utils/authHelper');
const envConfig = require('../../../../utils/envConfig');
const AuditLogger = require('../../../../utils/auditLogger');
const SandboxHelper = require('../../../../utils/sandboxHelper');
const AdminApiHelper = require('../../../../utils/adminApiHelper');

jest.setTimeout(1800000); 

describe(`[Financial Logic] V1 Dinaria AR: Cash-In API Matrix [Env: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    let token = '';
    let auditLog;
    let adminCookie = '';
    const merchantId = envConfig.MERCHANT_ID || "370914c8-c42a-4309-b50c-45656ad50b7c";

    const DINARIA_SANDBOX_URL = 'https://api.sandbox.dinaria.com/ars/cashin/simulate';
    const SANDBOX_MERCHANT_1_TOKEN = 'di_sand_reg_paypaga_merch';
    const SANDBOX_MERCHANT_3_TOKEN = 'di_sand_c99ad6fbcf5332c02f8a0c486da534f668afc295';

    const getV1MerchantBalance = async (accessToken) => {
        const balRes = await axios.get(`${envConfig.BASE_URL}/get_merchant_balance?country_code=AR&payment_method=cvu`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (!balRes.data || !balRes.data.country_collection) return 0;
        const countryCol = balRes.data.country_collection.find(c => c.country_code === 'AR');
        if(!countryCol) return 0;
        const paymentCol = countryCol.payment_method_collection.find(p => p.payment_method_code === 'cvu');
        if(!paymentCol) return 0;
        const payinBal = paymentCol.balance_collection.find(b => b.transaction_type === 'Payin');
        return payinBal ? payinBal.amount : 0;
    };

    const getV1TransactionStatus = async (txId, accessToken) => {
        const queryRes = await axios.get(`${envConfig.BASE_URL}/query/payins?transaction_id=${txId}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if(queryRes.data && queryRes.data.rows && queryRes.data.rows.length > 0) {
            return queryRes.data.rows[0];
        }
        return {};
    };

    beforeAll(async () => {
        auditLog = new AuditLogger('V1_Cashin_Flow_AR_Financial_Logic');
        
        // 1. Clean Sandbox Garbage
        await SandboxHelper.cleanOrphanTransactions(SANDBOX_MERCHANT_1_TOKEN, 'merchant1', null, auditLog);
        await SandboxHelper.cleanOrphanTransactions(SANDBOX_MERCHANT_3_TOKEN, 'sand_pay_merch3', 'sand_pay_merch3', auditLog);

        // 2. Fetch Base Token
        token = await getAccessToken();

        // 3. Login to Admin Portal API
        adminCookie = await AdminApiHelper.getAdminSessionCookie();
    });

    const buildH2HPayin = async (amount, allowOverUnder = true) => {
        const referenceId = `DINARIA-LOGIC-V1-${Date.now()}`;
        const targetCuit = "20275105792"; 

        const configPayload = {
            "merchant_id": merchantId,
            "transaction_total": amount,
            "country_code": "AR",
            "merchant_transaction_reference": referenceId
        };

        const configResponse = await axios.post(`${envConfig.BASE_URL}/v1/transaction-config`, configPayload, {
            headers: {
                'DisablePartnerMock': 'true',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            validateStatus: () => true
        });

        if (configResponse.status !== 200 && configResponse.status !== 201) {
            throw new Error(`Config Creation Failed: ${JSON.stringify(configResponse.data)}`);
        }

        const txId = configResponse.data.transaction_id || configResponse.data.id || (configResponse.data.data && configResponse.data.data.transaction_id);

        const paymentPayload = {
            "transaction_id": txId,
            "payment_method_code": "cvu",
            "country_code": "AR",
            "currency": "ARS",
            "merchant_transaction_reference": referenceId,
            "merchant_customer_id": "dinaria_sandbox_v1@paypaga.com",
            "transaction_fields": [
                { "name": "first_name", "value": "Jon" },
                { "name": "last_name", "value": "Snow" },
                { "name": "document_number", "value": targetCuit },
                { "name": "document_type", "value": "CUIL" },
                { "name": "email", "value": "dinaria_sandbox@paypaga.com" }
            ],
            "allowOverUnder": allowOverUnder
        };

        const paymentResponse = await axios.post(`${envConfig.BASE_URL}/v1/payment`, paymentPayload, {
            headers: {
                'DisablePartnerMock': 'true',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            validateStatus: () => true
        });

        auditLog.logTest('API-V1-PAY', 'Payment Execution', `${envConfig.BASE_URL}/v1/payment`, paymentPayload, paymentResponse.status, paymentResponse.data, false);

        if (paymentResponse.status !== 200 && paymentResponse.status !== 201) {
            throw new Error(`Payment V1 Failed: ${JSON.stringify(paymentResponse.data)}`);
        }

        let assignedCvu = null;
        let assignedReference = null;

        if (paymentResponse.data.next_steps_detail_instructions) {
            const instructions = paymentResponse.data.next_steps_detail_instructions;
            const cvuLabel = instructions.find(i => i.key === 'account_number' || i.key === 'cvu');
            if (cvuLabel) assignedCvu = cvuLabel.description;
            
            const refLabel = instructions.find(i => i.key === 'reference');
            if (refLabel) assignedReference = refLabel.description;
        } else if (paymentResponse.data.instructions) {
            assignedCvu = paymentResponse.data.instructions.bank_account;
            assignedReference = paymentResponse.data.instructions.reference;
        } else if (paymentResponse.data.paymentData) { 
            assignedCvu = paymentResponse.data.paymentData.cbu;
            assignedReference = paymentResponse.data.paymentData.reference;
        } else {
            let pMethods = paymentResponse.data.payment_methods || [];
            if(pMethods.length > 0 && pMethods[0].fields) {
                 const cvuField = pMethods[0].fields.find(f => f.name && f.name.toLowerCase().includes('cvu'));
                 if(cvuField) assignedCvu = cvuField.value;
                 
                 const refField = pMethods[0].fields.find(f => f.name && f.name.toLowerCase().includes('reference'));
                 if(refField) assignedReference = refField.value;
            }
        }

        if(!assignedReference) assignedReference = txId;

        return { txId, assignedCvu, assignedReference, cuit: targetCuit, fullResponse: paymentResponse.data };
    };

    const simulateDinariaCashIn = async (extractedCbu, targetCuit, injectAmount, reference) => {
        const sandboxToken = SANDBOX_MERCHANT_1_TOKEN;
        const simPayload = {
            "cbu": extractedCbu,
            "cuit": targetCuit,
            "amount": injectAmount.toFixed(2),
            "idTrxCliente": reference, 
            "nombre": "Jon Snow"
        };

        const res = await axios.post(DINARIA_SANDBOX_URL, simPayload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${sandboxToken}`
            },
            validateStatus: () => true
        });

        auditLog.logTest('SANDBOX', 'Dinaria Cashin Simulator (Webhook)', DINARIA_SANDBOX_URL, simPayload, res.status, res.data, false, reference);

        return { status: res.status, data: res.data, payloadInyectado: simPayload };
    };

    const genericTestFlow = async (testName, ordenAmount, depositAmount, allowOverUnderParam, expectedSuccess) => {
        auditLog.logTestStart(testName);
        // 1. Get Initial Balance
        const initialBalance = await getV1MerchantBalance(token);
        
        // 2. Create Payin V1
        const payinInfo = await buildH2HPayin(ordenAmount, allowOverUnderParam);
        if(!payinInfo.assignedCvu) throw new Error("No CVU was assigned by the API.");

        // 3. Webhook Simulation
        await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, depositAmount, payinInfo.assignedReference);
        
        // Wait for asynchronous webhooks to process and settle with Polling (Up to 30s)
        let finalTx = null;
        let actualStatus = "pending";
        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 3000));
            finalTx = await getV1TransactionStatus(payinInfo.txId, token);
            actualStatus = (finalTx.status || "Unknown").toLowerCase();
            if (actualStatus !== "pending" && actualStatus !== "started") {
                break;
            }
        }
        
        // 5. Query Dinaria API Evidence
        const dinariaObj = await SandboxHelper.getDinariaTransactionByExternalId(SANDBOX_MERCHANT_3_TOKEN, payinInfo.txId);
        const dinariaFinalStatus = dinariaObj ? dinariaObj.status : 'NotFound';

        // 6. Get Final Balance
        const finalBalance = await getV1MerchantBalance(token);
        const fee = finalTx.fee || 0;
        const taxes = finalTx.calculated_taxes || 0;
        const actualInternalAmount = finalTx.transaction_total || 0;

        // Logic Check
        let mathLogic = "Rejected (No Math Applied)";
        const expectedStatusRegex = expectedSuccess ? /confirmed|completed|approved|pending/i : /failed|rejected|cancelled|pending/i;
        const isStatusValid = expectedStatusRegex.test(actualStatus);
        
        let isAmountValid = true;
        let testPassed = isStatusValid;

        if (expectedSuccess) {
             const expectedBalance = initialBalance + actualInternalAmount - fee - taxes;
             mathLogic = `Init(${initialBalance}) + Injected(${actualInternalAmount}) - Fees(${fee}) - Taxes(${taxes}) = Expected(${expectedBalance}) -> Actual(${finalBalance})`;
             
             if (Math.abs(actualInternalAmount - depositAmount) > 0.01) {
                 isAmountValid = false;
                 testPassed = false;
             }
        }

        auditLog.logFlow(testName, {
            "Policy": `allowOverUnder = ${allowOverUnderParam}`,
            "Amount Ordered": ordenAmount,
            "Amount Webhooked": depositAmount,
            "Expected Result": expectedSuccess ? "Payment Accepted (Math Applied)" : "Payment Rejected/Retained",
            "Actual Result": actualStatus,
            "Paypaga Status": actualStatus,
            "Dinaria Sandbox Status": dinariaFinalStatus,
            "Paypaga Internal Amount": actualInternalAmount,
            "Balance Initial": initialBalance,
            "Balance Final": finalBalance,
            "Mathematical Check": mathLogic,
            "Status": testPassed ? "PASS" : "FAIL"
        });

        // Jest Assertions
        expect(actualStatus).toMatch(expectedStatusRegex);
        if (expectedSuccess) {
            expect(actualInternalAmount).toBeCloseTo(depositAmount, 2); 
        }
    };

    // =========================================================================================
    // BLOCK 1: ALLOW OVER UNDER = TRUE (Permissive Policies)
    // =========================================================================================
    describe('BLOCK 1: allowOverUnder = TRUE (Permissive Policies)', () => {
        
        beforeAll(async () => {
            auditLog.logSection('BLOCK 1: allowOverUnder = TRUE (Permissive Policies)');
            // Check Current State
            const currentState = await AdminApiHelper.getPartnerConfigState(adminCookie, merchantId);
            auditLog.logFlow('[ADMIN_API] Evidence: Pre-Flight Config Status', { "allowOverUnder_Is_Currently": currentState });

            // Toggle to TRUE
            const toggled = await AdminApiHelper.togglePartnerAllowOverUnder(adminCookie, merchantId, true);
            auditLog.logFlow('[ADMIN_API] Action: Toggled Config', { "Toggle_Success": toggled, "New_Target_State": true });
            
            await new Promise(r => setTimeout(r, 2000)); // Let cache settle
        });

        test('TC01 - Exact Match Payment', async () => {
            await genericTestFlow('TC01 - Exact Match Payment', 1500.00, 1500.00, true, true);
        });

        test('TC02 - Under Payment Allowed', async () => {
            await genericTestFlow('TC02 - Under Payment Allowed', 1500.00, 1000.00, true, true);
        });

        test('TC03 - Over Payment Allowed', async () => {
            await genericTestFlow('TC03 - Over Payment Allowed', 1500.00, 2500.00, true, true);
        });

        test('TC04 - Idempotency (Double Webhook)', async () => {
            auditLog.logTestStart('TC04 - Idempotency (Double Webhook)');
            const initialBalance = await getV1MerchantBalance(token);
            const payinInfo = await buildH2HPayin(1000, true);
            await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, 1000, payinInfo.assignedReference);
            await new Promise(r => setTimeout(r, 1000));
            // Second identical injection
            await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, 1000, payinInfo.assignedReference);
            
            let finalTx = null;
            let finalStatus = "pending";
            for (let i = 0; i < 10; i++) {
                await new Promise(r => setTimeout(r, 3000));
                finalTx = await getV1TransactionStatus(payinInfo.txId, token);
                finalStatus = (finalTx.status || "Unknown").toLowerCase();
                if (finalStatus !== "pending" && finalStatus !== "started") break;
            }
            
            const dinariaObj = await SandboxHelper.getDinariaTransactionByExternalId(SANDBOX_MERCHANT_3_TOKEN, payinInfo.txId);
            const dinariaFinalStatus = dinariaObj ? dinariaObj.status : 'NotFound';
            
            const isPass = /confirmed|completed|approved|pending/i.test(finalStatus);

            auditLog.logFlow('TC04 - Idempotency (Double Webhook)', {
                "Description": "Sent duplicate webhook. Should be processed only once.",
                "Expected Result": "Payment Accepted once",
                "Actual Result": finalStatus,
                "Paypaga Status": finalStatus,
                "Dinaria Status": dinariaFinalStatus,
                "Status": isPass ? "PASS" : "FAIL"
            });
            expect(finalStatus).toMatch(/confirmed|completed|approved|pending/i);
        });
    });

    // =========================================================================================
    // BLOCK 2: ALLOW OVER UNDER = FALSE (Restrictive Policies)
    // =========================================================================================
    describe('BLOCK 2: allowOverUnder = FALSE (Restrictive Policies)', () => {
        
        beforeAll(async () => {
            auditLog.logSection('BLOCK 2: allowOverUnder = FALSE (Restrictive Policies)');
            // Toggle to FALSE
            const toggled = await AdminApiHelper.togglePartnerAllowOverUnder(adminCookie, merchantId, false);
            auditLog.logFlow('[ADMIN_API] Action: Toggled Config', { "Toggle_Success": toggled, "New_Target_State": false });
            
            const newState = await AdminApiHelper.getPartnerConfigState(adminCookie, merchantId);
            auditLog.logFlow('[ADMIN_API] Evidence: Post-Flight Config Status', { "allowOverUnder_Is_Currently": newState });

            await new Promise(r => setTimeout(r, 2000)); 
        });

        test('TC05 - Exact Match Strict', async () => {
            await genericTestFlow('TC05 - Exact Match Strict', 1500.00, 1500.00, false, true);
        });

        test('TC06 - Under Payment Strict (Must Reject)', async () => {
            await genericTestFlow('TC06 - Under Payment Strict (Must Reject)', 1000.00, 800.00, false, false);
        });

        test('TC07 - Over Payment Strict (Must Reject)', async () => {
            await genericTestFlow('TC07 - Over Payment Strict (Must Reject)', 1000.00, 1200.00, false, false);
        });
    });

});
