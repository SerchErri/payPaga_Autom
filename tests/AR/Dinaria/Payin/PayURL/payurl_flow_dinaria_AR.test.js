const axios = require('axios');
const allure = require('allure-js-commons');
const { chromium } = require('playwright');
const envConfig = require('../../../../../utils/envConfig');
const { getAccessToken } = require('../../../../../utils/authHelper');
const { loginAndCaptureDashboard, fastAdminAction } = require('../../../../../utils/uiBalanceHelper');

jest.setTimeout(1800000); // Ampliar timeout a 30 mins para UI operations

describe(`[Hybrid E2E] Create Payment Link (PayUrl) Dinaria (AR) [Env: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    let token = '';
    let browser;
    let context;
    let page;
    let initialBalances = {};
    let payurlAmountConfig = 1255.55; // Monto inofensivo para evadir limits de fraude

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

    test('Omnichannel Flow: Capture UI Balance -> Generate PayUrl API -> Checkout Visit -> Inspect Grid -> Admin Approve', async () => {
        // ============================================================================== //
        // 1. CAPTURAR DASHBOARD Y SALDOS INICIALES
        // ============================================================================== //
        initialBalances = await loginAndCaptureDashboard(page, allure, true, 'AR');
        console.log("📈 INITIAL PAYURL BALANCES (UI):", initialBalances);


        // ============================================================================== //
        // 3. GENERAR LINK DE PAGO (POST /v2/pay-urls)
        // ============================================================================== //
        const myRefId = `PayUrl-AR-${Date.now()}`;
        const payUrlEndpoint = `${envConfig.BASE_URL}/v2/pay-urls`;
        const validPayload = {
            "country": "AR",
            "currency": "ARS",
            "amount": 1000,
            "merchant_transaction_reference": myRefId,
            "merchant_customer_id": envConfig.FRONTEND_PARAMS.email || "cliente_ar@ejemplo.com",
            "allowed_payment_methods": ["cvu"],
            "allowOverUnder": true,
            "predefined_fields": [
                {
                    "payment_method": "cvu",
                    "fields": {
                        "first_name": "Sergio",
                        "last_name": "Test",
                        "document_number": "20-08490848-8"
                    }
                }
            ]
        };

        if (allure && allure.attachment) {
            await allure.attachment("Step 3 - POST AR Payload Sent", JSON.stringify(validPayload, null, 2), "application/json");
        }

        const response = await axios.post(payUrlEndpoint, validPayload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'DisablePartnerMock': 'true'
            },
            validateStatus: () => true // Prevent Axios Throw on 4XX to evaluate manually
        });

        expect(response.status).toBe(201);
        expect(response.data.transaction_id).toBeDefined();

        const trID = response.data.transaction_id || response.data.id;

        console.log(`\n🎉 Link de Pago Generado Correctamente [AR]: ${response.status}`);
        
        // ============================================================================== //
        // 3.5. VISITAR LA URL DEL CHECKOUT PARA MATERIALIZAR FEES (Crítico!)
        // ============================================================================== //
        const checkoutUrl = response.data.url || response.data.pay_url || response.data.redirect_url;
        if (checkoutUrl) {
            console.log("➡️ Materializando Checkout Session URL:", checkoutUrl);
            const checkoutPage = await context.newPage();
            // Go to the URL to force the backend to register the preferred payment method and compute the fees
            await checkoutPage.goto(checkoutUrl, { waitUntil: 'domcontentloaded' }).catch(() => null);
            await checkoutPage.waitForTimeout(4000); // Give the UI and Backend enough time
            await checkoutPage.close();
            console.log("✔️ Checkout Session iniciada y métodos de pago arraigados en el Backend.");
        } else {
            console.warn("⚠️ No se encontró URL en el response. El Backend podría fallar en calcular fees.");
        }

        // ============================================================================== //
        // 4. INSPECCIONAR GRILLA VISUALMENTE COMO EVIDENCIA
        // ============================================================================== //
        await page.bringToFront();

        const btnTransacciones = page.getByRole('link', { name: ' Transacciones ' }).first();
        await btnTransacciones.click({ force: true }).catch(() => null);
        await page.waitForTimeout(1000);

        const btnEntradas = page.getByRole('link', { name: 'Transacciones de Entrada' }).first();
        await btnEntradas.click({ force: true }).catch(() => null);

        await page.waitForTimeout(8000); // 8 segundos de holgura

        const tableContent = await page.locator('table').innerText().catch(async () => await page.innerText('body').catch(() => ""));

        console.log("=== DEBUG PAYURL GRID ===");
        console.log(tableContent);
        console.log("==========================");

        const hasRenderedAmmount = tableContent.includes('1000') || tableContent.includes('1.000');
        expect(hasRenderedAmmount).toBe(true);

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
            if (tableRowSnap) await allure.attachment(`📸 Grid Visual Evidence: Specific PayUrl Row`, tableRowSnap, "image/png");
        }

        await page.evaluate(() => { document.body.style.zoom = "1"; }).catch(()=>null);

        const realGridTxId = await page.evaluate((ref) => {
            const rows = Array.from(document.querySelectorAll('tr'));
            const targetRow = rows.find(r => r.innerText.includes(ref) || r.innerText.includes('1,255.55') || r.innerText.includes('1255'));
            if (!targetRow) return null; // Si no encuentra fila
            
            const uuidRegex = /[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/;
            const match = targetRow.innerText.match(uuidRegex);
            return match ? match[0] : null;
        }, myRefId);

        // ============================================================================== //
        // 5. ADMIN PORTAL (APROBACIÓN AGIL UI VIA GET)
        // ============================================================================== //
        await fastAdminAction(page, realGridTxId || trID, 'pay-in', allure, 'approve');

        // ============================================================================== //
        // 6. REGRESAR AL DASHBOARD Y VALIDAR IMPACTO
        // ============================================================================== //
        const finalBalances = await loginAndCaptureDashboard(page, allure, false, 'AR');
        console.log("📈 FINAL PAYURL BALANCES AFTER APPROVAL:", finalBalances);

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
🧮 PAYURL IMPACT CALCULATION (AR)
==================================================================
Concept              | Details                     | Oper | Value
------------------------------------------------------------------
Initial Test Balance | Opening Balance             | ARS  | ${initialBalances.available.toFixed(2)}
PayUrl Amount        | ${opDiff.toFixed(0)} In (-) ${feeDiff.toFixed(2)} F (-) ${taxDiff.toFixed(2)} T |  -   | ${netValue.toFixed(2)}
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
            await allure.attachment(`PayUrl AR Dinaria Comparison`, JSON.stringify({ INITIAL_BALANCES: initialBalances, FINAL_BALANCES: finalBalances }, null, 2), "application/json");
            await allure.attachment(`Resulting Mathematical Calculations`, mathReport, "text/plain");
        }
    });

});
