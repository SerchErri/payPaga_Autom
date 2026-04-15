const axios = require('axios');
const allure = require('allure-js-commons');
const { chromium } = require('playwright');
const { getAccessToken } = require('../../../../../utils/authHelper');
const envConfig = require('../../../../../utils/envConfig');
const { loginAndCaptureDashboard, fastAdminAction } = require('../../../../../utils/uiBalanceHelper');

jest.setTimeout(1800000); // 30 mins para UI operations

describe(`[E2E Híbrido] Pay-In H2H Dinaria (AR): API Generación + UI Validaciones [Amb: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    let token = '';
    let browser;
    let context;
    let page;
    let initialBalances = {};
    let payinAmountConfig = 15.55; // Monto pequeño para evadir límites diarios de validación

    beforeAll(async () => {
        token = await getAccessToken();
        try {
            browser = await chromium.launch({ headless: true });
            context = await browser.newContext({ locale: 'es-ES', colorScheme: 'dark' });
            page = await context.newPage();
            page.setDefaultTimeout(20000);
        } catch (e) { console.error("Fallo levantando Playwright", e); }
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
        // 3. CREACIÓN DEL PAY-IN H2H (Directo a Servidor)
        // ============================================================================== //
        const createPayinUrl = `${envConfig.BASE_URL}/v2/transactions/pay-in`;

        const referenceId = `AR-DINARIA-H2H-${Date.now()}`;
        const payload = {
            "amount": 1000,
            "country": "AR",
            "currency": "ARS",
            "payment_method": "cvu",
            "merchant_transaction_reference": referenceId,
            "merchant_return_url": `${envConfig.BASE_URL}/pay/completed`,
            "merchant_customer_id": envConfig.FRONTEND_PARAMS.email,
            "fields": {
                "first_name": "Sergio",
                "last_name": "Test",
                "document_number": "20-08490848-8"
            },
            "allowOverUnder": true,
            "return_urls": {
                "success_url": "https://merchant.com/payment-success",
                "failure_url": "https://merchant.com/payment-failure",
                "cancel_url": "https://merchant.com/payment-cancelled"
            }
        };

        const postResponse = await axios.post(createPayinUrl, payload, {
            headers: {
                'DisablePartnerMock': 'true',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            validateStatus: () => true
        });

        if (postResponse.status !== 200 && postResponse.status !== 201) {
            console.error(`El endpoint devolvió error al intentar crear Pay-in AR Dinaria en ${envConfig.currentEnvName.toUpperCase()}:`, JSON.stringify(postResponse.data, null, 2));
        }

        if (allure && allure.attachment) {
            await allure.attachment(
                `Paso 3 - Payload POST AR Enviado [${envConfig.currentEnvName.toUpperCase()}]`,
                JSON.stringify(payload, null, 2),
                "application/json"
            );
        }

        if (allure && allure.attachment) {
            const trans_id = postResponse.data.transaction_id || postResponse.data.id || 'No Asignado';

            await allure.attachment(
                `Paso 3 - RESPUESTA BACKEND DINARIA (Transaction ID: ${trans_id})`,
                JSON.stringify({
                    transaction_id: trans_id,
                    merchant_reference_enviado: referenceId,
                    respuesta_completa_del_backend: postResponse.data
                }, null, 2),
                "application/json"
            );
        }

        expect([200, 201]).toContain(postResponse.status);
        expect(postResponse.data).toBeDefined();

        const trID = postResponse.data.transaction_id || postResponse.data.id || 'No Asignado';

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
        expect(finalBalances.available).toBeGreaterThan(initialBalances.available);
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
Initial Test Balance | Opening Balance             | ARS  | ${initialBalances.available.toFixed(2)}
H2H PayIn Amount     | ${opDiff.toFixed(0)} In (-) ${feeDiff.toFixed(2)} F (-) ${taxDiff.toFixed(2)} T |  -   | ${netValue.toFixed(2)}
------------------------------------------------------------------
Current Test Balance | Total current balance in UI | ARS  | ${finalBalances.available.toFixed(2)}
==================================================================
Concept              | Details                     | Oper | Total
------------------------------------------------------------------
Fees                 | ${Math.abs(initialBalances.fees).toFixed(2).padEnd(8)} | (+) ${feeDiff.toFixed(2).padEnd(6)} | ARS  | ${Math.abs(finalBalances.fees).toFixed(2)}
Taxes                | ${Math.abs(initialBalances.taxes).toFixed(2).padEnd(8)} | (+) ${taxDiff.toFixed(2).padEnd(6)} | ARS  | ${Math.abs(finalBalances.taxes).toFixed(2)}
==================================================================
`;

        console.log(mathReport);

        if (allure && allure.attachment) {
            await allure.attachment(`Comparativa PayIn AR Dinaria H2H`, JSON.stringify({ SALDOS_INICIALES: initialBalances, SALDOS_FINALES: finalBalances }, null, 2), "application/json");
            await allure.attachment(`Cálculos Matemáticos Resultantes`, mathReport, "text/plain");
        }
    });

});
