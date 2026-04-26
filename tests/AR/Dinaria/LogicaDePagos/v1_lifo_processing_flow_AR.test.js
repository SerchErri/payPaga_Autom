const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../../../utils/authHelper');
const envConfig = require('../../../../utils/envConfig');
const AuditLogger = require('../../../../utils/auditLogger');
const SandboxHelper = require('../../../../utils/sandboxHelper');
const AdminApiHelper = require('../../../../utils/adminApiHelper');

jest.setTimeout(1800000); 

describe(`[Financial Logic] V1 Dinaria AR: LIFO Processing Matrix [Env: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    let token = '';
    let auditLog;
    let adminCookie = '';
    const merchantId = envConfig.MERCHANT_ID || "370914c8-c42a-4309-b50c-45656ad50b7c";

    const DINARIA_SANDBOX_URL = 'https://api.sandbox.dinaria.com/ars/cashin/simulate';
    const SANDBOX_MERCHANT_1_TOKEN = 'di_sand_reg_paypaga_merch';
    const SANDBOX_MERCHANT_3_TOKEN = 'di_sand_c99ad6fbcf5332c02f8a0c486da534f668afc295';

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
        auditLog = new AuditLogger('V1_LIFO_Processing_Flow_AR');
        
        // 1. Clean Sandbox Garbage
        await SandboxHelper.cleanOrphanTransactions(SANDBOX_MERCHANT_1_TOKEN, 'merchant1', null, auditLog);
        await SandboxHelper.cleanOrphanTransactions(SANDBOX_MERCHANT_3_TOKEN, 'sand_pay_merch3', 'sand_pay_merch3', auditLog);

        // 2. Fetch Base Token
        token = await getAccessToken();

        // 3. Login to Admin Portal API
        adminCookie = await AdminApiHelper.getAdminSessionCookie();

        // 4. Ensure allowOverUnder is TRUE for testing
        await AdminApiHelper.togglePartnerAllowOverUnder(adminCookie, merchantId, true);
        await new Promise(r => setTimeout(r, 2000));
    });

    const buildH2HPayin = async (amount) => {
        const referenceId = `DINARIA-LIFO-V1-${Date.now()}`;
        const targetCuit = "20275105792"; 

        const configPayload = {
            "merchant_id": merchantId,
            "transaction_total": amount,
            "country_code": "AR",
            "merchant_transaction_reference": referenceId
        };

        const configResponse = await axios.post(`${envConfig.BASE_URL}/v1/transaction-config`, configPayload, {
            headers: { 'DisablePartnerMock': 'true', 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            validateStatus: () => true
        });

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
            "allowOverUnder": true
        };

        const paymentResponse = await axios.post(`${envConfig.BASE_URL}/v1/payment`, paymentPayload, {
            headers: { 'DisablePartnerMock': 'true', 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            validateStatus: () => true
        });

        auditLog.logTest('API-V1-PAY', `Payment Execution [${referenceId}]`, `${envConfig.BASE_URL}/v1/payment`, paymentPayload, paymentResponse.status, paymentResponse.data, false);

        let assignedCvu = null;
        let bankReference = referenceId;
        if (paymentResponse.data.next_steps_detail_instructions) {
            const instructions = paymentResponse.data.next_steps_detail_instructions;
            const cvuLabel = instructions.find(i => i.key === 'account_number' || i.key === 'cvu');
            if (cvuLabel) assignedCvu = cvuLabel.description;
            
            const refLabel = instructions.find(i => i.key === 'reference');
            if (refLabel) bankReference = refLabel.description;
        }

        return { txId, assignedCvu, assignedReference: bankReference, cuit: targetCuit, timestamp: Date.now() };
    };

    const simulateDinariaCashIn = async (extractedCbu, targetCuit, injectAmount, referenceParam) => {
        const sandboxToken = SANDBOX_MERCHANT_1_TOKEN;
        const simPayload = {
            "cbu": extractedCbu,
            "cuit": targetCuit,
            "amount": injectAmount.toFixed(2),
            "idTrxCliente": referenceParam, 
            "nombre": "Jon Snow"
        };

        const res = await axios.post(DINARIA_SANDBOX_URL, simPayload, {
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sandboxToken}` },
            validateStatus: () => true
        });

        auditLog.logTest('SANDBOX', 'Dinaria Cashin Simulator (LIFO Webhook)', DINARIA_SANDBOX_URL, simPayload, res.status, res.data, false, referenceParam);
        return { status: res.status, data: res.data };
    };

    describe('BLOCK 1: LIFO Matching by CUIT/CVU (No Exact Reference)', () => {
        
        test('TC01 - 3 Orders, 1 Payment (Should clear newest)', async () => {
            auditLog.logTestStart('TC01 - LIFO Matching Validation (3 Pending Orders)');
            
            // 1. Generate TX1 (Oldest)
            const tx1 = await buildH2HPayin(1000.00);
            await new Promise(r => setTimeout(r, 1500)); // Delay to ensure strictly different timestamps
            
            // 2. Generate TX2 (Middle)
            const tx2 = await buildH2HPayin(1000.00);
            await new Promise(r => setTimeout(r, 1500));
            
            // 3. Generate TX3 (Newest)
            const tx3 = await buildH2HPayin(1000.00);

            // Log the generation batch
            auditLog.logFlow('Batch Generation Phase', {
                "TX1 (Oldest)": tx1.txId,
                "TX2 (Middle)": tx2.txId,
                "TX3 (Newest)": tx3.txId,
                "Target CVU": tx3.assignedCvu,
                "Target CUIT": tx3.cuit
            });

            // 4. Webhook Simulation
            // We use a random reference to bypass exact matching, forcing the engine to search by CUIT/CVU.
            const fakeReference = `LIFO-BLIND-${Date.now()}`;
            await simulateDinariaCashIn(tx3.assignedCvu, tx3.cuit, 1000.00, fakeReference);

            // 5. Polling Loop
            let tx3Final = null;
            let tx3Status = "pending";
            
            for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 3000));
                tx3Final = await getV1TransactionStatus(tx3.txId, token);
                tx3Status = (tx3Final.status || "Unknown").toLowerCase();
                if (tx3Status !== "pending" && tx3Status !== "started") break;
            }

            // Get statuses for the older ones
            const tx1Final = await getV1TransactionStatus(tx1.txId, token);
            const tx2Final = await getV1TransactionStatus(tx2.txId, token);

            const s1 = (tx1Final.status || "Unknown").toLowerCase();
            const s2 = (tx2Final.status || "Unknown").toLowerCase();

            const isLifoSuccessful = (tx3Status === "approved" || tx3Status === "completed") && (s1 === "pending" || s1 === "started") && (s2 === "pending" || s2 === "started");

            // Log Final State Matrix
            auditLog.logFlow('LIFO Resolution Matrix', {
                "Engine Behavior": "Paypaga should match CUIT+CVU to the most recent transaction.",
                "TX1 Status (Oldest)": s1,
                "TX2 Status (Middle)": s2,
                "TX3 Status (Newest)": tx3Status,
                "Expected Pattern": "TX1=pending, TX2=pending, TX3=approved",
                "Actual Pattern": `TX1=${s1}, TX2=${s2}, TX3=${tx3Status}`,
                "Status": isLifoSuccessful ? "PASS" : "FAIL"
            });

            expect(isLifoSuccessful).toBe(true);
        });

        test('TC02 - LIFO Successive Consumption', async () => {
            auditLog.logTestStart('TC02 - LIFO Successive Consumption (3 Orders, 2 Payments)');
            const tx1 = await buildH2HPayin(1000.00); await new Promise(r => setTimeout(r, 1500));
            const tx2 = await buildH2HPayin(1000.00); await new Promise(r => setTimeout(r, 1500));
            const tx3 = await buildH2HPayin(1000.00);

            await simulateDinariaCashIn(tx3.assignedCvu, tx3.cuit, 1000.00, `LIFO-BLIND-${Date.now()}-A`);
            await new Promise(r => setTimeout(r, 5000)); // give time for the first payment to lock tx3
            await simulateDinariaCashIn(tx3.assignedCvu, tx3.cuit, 1000.00, `LIFO-BLIND-${Date.now()}-B`);
            
            let s3 = "pending", s2 = "pending", s1 = "pending";
            for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 3000));
                s3 = ((await getV1TransactionStatus(tx3.txId, token)).status || "Unknown").toLowerCase();
                s2 = ((await getV1TransactionStatus(tx2.txId, token)).status || "Unknown").toLowerCase();
                s1 = ((await getV1TransactionStatus(tx1.txId, token)).status || "Unknown").toLowerCase();
                if (s3 !== "pending" && s2 !== "pending") break;
            }

            const isSuccess = (s3 === "approved" || s3 === "completed") && (s2 === "approved" || s2 === "completed") && (s1 === "pending" || s1 === "started");
            auditLog.logFlow('TC02 Resolution', { "TX1": s1, "TX2": s2, "TX3": s3, "Status": isSuccess ? "PASS" : "FAIL" });
            expect(isSuccess).toBe(true);
        });

        test('TC03 - LIFO + Over Payment', async () => {
            auditLog.logTestStart('TC03 - LIFO + Over Payment ($1500 on $1000 order)');
            const tx1 = await buildH2HPayin(1000.00); await new Promise(r => setTimeout(r, 1500));
            const tx2 = await buildH2HPayin(1000.00);

            await simulateDinariaCashIn(tx2.assignedCvu, tx2.cuit, 1500.00, `LIFO-BLIND-${Date.now()}`);
            
            let finalTx2 = null;
            let s2 = "pending";
            for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 3000));
                finalTx2 = await getV1TransactionStatus(tx2.txId, token);
                s2 = (finalTx2.status || "Unknown").toLowerCase();
                if (s2 !== "pending" && s2 !== "started") break;
            }
            const s1 = ((await getV1TransactionStatus(tx1.txId, token)).status || "Unknown").toLowerCase();

            const isSuccess = (s2 === "approved" || s2 === "completed") && (s1 === "pending" || s1 === "started") && (finalTx2.transaction_total === 1500);
            auditLog.logFlow('TC03 Resolution', { "TX1": s1, "TX2": s2, "TX2_Amount": finalTx2.transaction_total, "Status": isSuccess ? "PASS" : "FAIL" });
            expect(isSuccess).toBe(true);
        });

        test('TC04 - Exact Match Override', async () => {
            auditLog.logTestStart('TC04 - Exact Match Override (Bypass LIFO with Exact UUID)');
            const tx1 = await buildH2HPayin(1000.00); await new Promise(r => setTimeout(r, 1500));
            const tx2 = await buildH2HPayin(1000.00);

            // We specifically send the reference of TX1 (the oldest)
            await simulateDinariaCashIn(tx1.assignedCvu, tx1.cuit, 1000.00, tx1.assignedReference);
            
            let s1 = "pending";
            for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 3000));
                s1 = ((await getV1TransactionStatus(tx1.txId, token)).status || "Unknown").toLowerCase();
                if (s1 !== "pending" && s1 !== "started") break;
            }
            const s2 = ((await getV1TransactionStatus(tx2.txId, token)).status || "Unknown").toLowerCase();

            const isSuccess = (s1 === "approved" || s1 === "completed") && (s2 === "pending" || s2 === "started");
            auditLog.logFlow('TC04 Resolution', { "TX1 (Oldest)": s1, "TX2 (Newest)": s2, "Status": isSuccess ? "PASS" : "FAIL" });
            expect(isSuccess).toBe(true);
        });

        test.skip('TC05 - LIFO Skip Expired', async () => {
            auditLog.logTestStart('TC05 - LIFO Skip Expired (TX2 is Cancelled/Expired)');
            const tx1 = await buildH2HPayin(1000.00); await new Promise(r => setTimeout(r, 1500));
            const tx2 = await buildH2HPayin(1000.00);

            // Cancel/Expire TX2 manually via Admin API
            await AdminApiHelper.expireTransaction(adminCookie, merchantId, tx2.txId);
            await new Promise(r => setTimeout(r, 2000)); // wait for expiration to settle

            await simulateDinariaCashIn(tx2.assignedCvu, tx2.cuit, 1000.00, `LIFO-BLIND-${Date.now()}`);
            
            let s1 = "pending";
            for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 3000));
                s1 = ((await getV1TransactionStatus(tx1.txId, token)).status || "Unknown").toLowerCase();
                if (s1 !== "pending" && s1 !== "started") break;
            }
            const s2 = ((await getV1TransactionStatus(tx2.txId, token)).status || "Unknown").toLowerCase();

            const isSuccess = (s1 === "approved" || s1 === "completed") && (s2 === "expired" || s2 === "cancelled" || s2 === "failed");
            auditLog.logFlow('TC05 Resolution', { "TX1": s1, "TX2": s2, "Status": isSuccess ? "PASS" : "FAIL" });
            expect(isSuccess).toBe(true);
        });

    });
});
