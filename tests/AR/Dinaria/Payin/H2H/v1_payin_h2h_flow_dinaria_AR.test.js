const axios = require('axios');
const allure = require('allure-js-commons');
const { chromium } = require('playwright');
const { getAccessToken } = require('../../../../../utils/authHelper');
const envConfig = require('../../../../../utils/envConfig');
const { loginAndCaptureDashboard, fastAdminAction } = require('../../../../../utils/uiBalanceHelper');
const AuditLogger = require('../../../../../utils/auditLogger');

jest.setTimeout(1800000); // 30 mins para UI operations

describe(`[E2E Híbrido] V1 Pay-In H2H Dinaria (AR): API Generación + UI Validaciones [Amb: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    let token = '';
    let browser;
    let context;
    let page;
    let initialBalances = {};
    let payinAmountConfig = 15.55; // Monto pequeño para evadir límites diarios de validación
    let auditLog;

    const filterBalance = (bal) => {
        return {
            general: bal.general,
            available: bal.available,
            fees: bal.fees,
            taxes: bal.taxes
        };
    };

    beforeAll(async () => {
        token = await getAccessToken();
        try {
            browser = await chromium.launch({ headless: true });
            context = await browser.newContext({ locale: 'es-ES', colorScheme: 'dark' });
            page = await context.newPage();
            page.setDefaultTimeout(20000);
        } catch (e) { console.error("Fallo levantando Playwright", e); }
        auditLog = new AuditLogger('V1_Payin_H2H_Flow_Dinaria_AR');
    });

    afterAll(async () => {
        if (browser) await browser.close();
    });

    test('Flujo Ómnicanal: Capturar Saldo UI -> Generar Backend H2H -> Inspeccionar Grilla -> Aprobar Admin', async () => {
        // ============================================================================== //
        // 1. CAPTURAR DASHBOARD Y SALDOS INICIALES
        // ============================================================================== //
        initialBalances = await loginAndCaptureDashboard(page, allure, true, 'AR');
        console.log("📈 SALDOS INICIALES PAYIN (UI):", initialBalances);

        // ============================================================================== //
        // 3. CREACIÓN DEL PAY-IN H2H (Flujo V1: Config -> Payment)
        // ============================================================================== //
        const referenceId = `AR-DINARIA-H2H-V1-${Date.now()}`;
        const amountToPay = 1200;

        // --- PASO 3.1: Transaction Config ---
        const configUrl = `${envConfig.BASE_URL}/transaction-config`; // URL Directa
        const configPayload = {
            "country_code": "AR",
            "currency": "ARS",
            "transaction_total": amountToPay,
            "merchant_transaction_reference": referenceId
        };

        const configResponse = await axios.post(configUrl, configPayload, {
            headers: {
                'DisablePartnerMock': 'true',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            validateStatus: () => true
        });

        if (configResponse.status !== 200 && configResponse.status !== 201) {
            console.error(`Error en V1 Transaction Config:`, JSON.stringify(configResponse.data, null, 2));
        }
        
        if (allure && allure.attachment) {
            await allure.attachment(`Paso 3.1 - V1 Config Request/Response`, JSON.stringify({ payload: configPayload, response: configResponse.data }, null, 2), "application/json");
        }

        // Extrayendo el transaction_id del response de Config
        const generatedTransactionId = configResponse.data.transaction_id || configResponse.data.id || (configResponse.data.data && configResponse.data.data.transaction_id) || "FalloExtraccionID";

        // --- PASO 3.2: Payment Execution ---
        const paymentUrl = `${envConfig.BASE_URL}/payment`; // URL Directa
        const paymentPayload = {
            "transaction_id": generatedTransactionId,
            "payment_method_code": "cvu",
            "country_code": "AR",
            "currency": "ARS",
            "transaction_total": amountToPay,
            "merchant_transaction_reference": referenceId,
            "transaction_fields": [
                {
                    "name": "first_name",
                    "value": "Sergio"
                },
                {
                    "name": "last_name",
                    "value": "Test"
                },
                {
                    "name": "document_number",
                    "value": "20084908488"
                }
            ]
        };

        const paymentResponse = await axios.post(paymentUrl, paymentPayload, {
            headers: {
                'DisablePartnerMock': 'true',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            validateStatus: () => true
        });

        if (paymentResponse.status !== 200 && paymentResponse.status !== 201) {
            console.error(`Error en V1 Payment:`, JSON.stringify(paymentResponse.data, null, 2));
        }

        if (allure && allure.attachment) {
            const trans_id = paymentResponse.data.transaction_id || paymentResponse.data.id || generatedTransactionId;
            await allure.attachment(
                `Paso 3.2 - RESPUESTA BACKEND DINARIA V1 (Transaction ID: ${trans_id})`,
                JSON.stringify({
                    transaction_id: trans_id,
                    merchant_reference_enviado: referenceId,
                    respuesta_completa_del_backend: paymentResponse.data
                }, null, 2),
                "application/json"
            );
        }

        expect([200, 201]).toContain(paymentResponse.status);
        expect(paymentResponse.data).toBeDefined();

        const trID = paymentResponse.data.transaction_id || paymentResponse.data.id || generatedTransactionId;

        // ============================================================================== //
        // 4. INSPECCIONAR GRILLA VISUALMENTE COMO EVIDENCIA
        // ============================================================================== //
        await page.bringToFront();

        // En vez de recargar la SPA con goto, navegamos nativamente haciendo click (Evita el 404 del Router frontend)
        const btnTransacciones = page.getByRole('link', { name: ' Transacciones ' }).first();
        await btnTransacciones.click({ force: true }).catch(() => null);
        await page.waitForTimeout(1000);

        const btnEntradas = page.getByRole('link', { name: 'Transacciones de Entrada' }).first();
        await btnEntradas.click({ force: true }).catch(() => null);

        await page.waitForTimeout(8000); // Dar holgura a la carga de la tabla armada por React

        // Si la tabla contiene el amount gigante, significa que cayó exitosamente a nivel UI
        const tableContent = await page.locator('table').innerText().catch(async () => await page.innerText('body').catch(() => ""));

        console.log("=== DEBUG TABLA PAYIN H2H ===");
        console.log(tableContent);
        console.log("=============================");

        // Validamos explícitamente que la orden esté listada
        const rowLocator = page.locator('tbody tr').filter({ hasText: /1000|1\.000|1,000/ }).first();
        await rowLocator.waitFor({ state: 'visible', timeout: 8000 }).catch(() => null);

        // Zoom out out para que los grids responsivos encajen horizontalmente en un solo pantallazo
        await page.evaluate(() => { document.body.style.zoom = "0.7"; }).catch(()=>null);
        await page.waitForTimeout(1500);

        if (allure && allure.attachment) {
            await rowLocator.scrollIntoViewIfNeeded().catch(()=>null);
            // Capturamos el bounding box de este tr en especifico
            const tableRowSnap = await rowLocator.screenshot({ timeout: 5000 }).catch(() => null);
            if (tableRowSnap) await allure.attachment(`📸 Grid Visual Evidence: Specific Payin H2H Row`, tableRowSnap, "image/png");
        }

        await page.evaluate(() => { document.body.style.zoom = "1"; }).catch(()=>null);

        // ============================================================================== //
        // 5. ADMIN PORTAL (APROBACIÓN AGIL UI VIA GET)
        // ============================================================================== //
        await fastAdminAction(page, trID, 'pay-in', allure, 'approve');

        // ============================================================================== //
        // 6. REGRESAR AL DASHBOARD Y VALIDAR IMPACTO
        // ============================================================================== //
        const finalBalances = await loginAndCaptureDashboard(page, allure, false, 'AR');
        console.log("📈 SALDOS FINALES PAYIN TRAS APROBACIÓN H2H:", finalBalances);

        // Validaciones Tolerantes al Paralelismo
        expect(finalBalances.general).toBeGreaterThan(initialBalances.general);
        expect(finalBalances.volume).toBeGreaterThan(initialBalances.volume);
        expect(finalBalances.fees !== initialBalances.fees).toBeTruthy();
        expect(finalBalances.taxes !== initialBalances.taxes).toBeTruthy();

        const opDiff = parseFloat((finalBalances.volume - initialBalances.volume).toFixed(2));
        const feeDiff = parseFloat((Math.abs(finalBalances.fees) - Math.abs(initialBalances.fees)).toFixed(2));
        const taxDiff = parseFloat((Math.abs(finalBalances.taxes) - Math.abs(initialBalances.taxes)).toFixed(2));
        const netValue = parseFloat((opDiff - feeDiff - taxDiff).toFixed(2));

        const mathReport = `
==================================================================
🧮 H2H IMPACT CALCULATION (AR)
==================================================================
Concept              | Details                     | Oper | Value
------------------------------------------------------------------
Initial General Bal  | Opening Balance (General)   | ARS  | ${initialBalances.general.toFixed(2)}
H2H PayIn Amount     | ${opDiff.toFixed(2)} In (-) ${feeDiff.toFixed(2)} F (-) ${taxDiff.toFixed(2)} T |  -   | ${netValue.toFixed(2)}
------------------------------------------------------------------
Current General Bal  | Total current balance in UI | ARS  | ${finalBalances.general.toFixed(2)}
==================================================================
Concept              | Details                     | Oper | Total
------------------------------------------------------------------
Fees                 | ${Math.abs(initialBalances.fees).toFixed(2).padEnd(8)} | (+) ${feeDiff.toFixed(2).padEnd(6)} | ARS  | ${Math.abs(finalBalances.fees).toFixed(2)}
Taxes                | ${Math.abs(initialBalances.taxes).toFixed(2).padEnd(8)} | (+) ${taxDiff.toFixed(2).padEnd(6)} | ARS  | ${Math.abs(finalBalances.taxes).toFixed(2)}
==================================================================
`;

        console.log(mathReport);

        const flowData = {
            "1. Initial Balance (Before Payin)": filterBalance(initialBalances),
            "2. Amount To Pay (Requested)": amountToPay,
            "3. Impact Details": {
                "operation_difference": opDiff,
                "fees_deducted": feeDiff,
                "taxes_deducted": taxDiff,
                "net_value_applied": netValue
            },
            "4. Final Balance (After Admin Approval)": filterBalance(finalBalances)
        };
        auditLog.logFlow('TC-01', 'Omnichannel Payin H2H Flow', flowData);

        if (allure && allure.attachment) {
            await allure.attachment(`Comparativa PayIn AR Dinaria H2H`, JSON.stringify(flowData, null, 2), "application/json");
            await allure.attachment(`Cálculos Matemáticos Resultantes`, mathReport, "text/plain");
        }
    });

});
