const axios = require('axios');
const allure = require('allure-js-commons');
const { chromium } = require('playwright');
const envConfig = require('../../../../../utils/envConfig');
const { getAccessToken } = require('../../../../../utils/authHelper');
const { loginAndCaptureDashboard, fastAdminApprove } = require('../../../../../utils/uiBalanceHelper');

jest.setTimeout(1800000); // Ampliar timeout a 30 mins para UI operations

describe(`[E2E Híbrido] Crear Link de Pago (PayUrl) EC [Amb: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

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

    test('Flujo Ómnicanal: Capturar Saldo UI -> Generar PayUrl API -> Inspeccionar Grilla -> Aprobar Admin', async () => {
        // ============================================================================== //
        // 1. CAPTURAR DASHBOARD Y SALDOS INICIALES
        // ============================================================================== //
        initialBalances = await loginAndCaptureDashboard(page, allure, true);
        console.log("📈 SALDOS INICIALES PAYURL (UI):", initialBalances);

        // ============================================================================== //
        // 2. CONFIGURACIÓN GET EC (Validación Dinámica de Fee Payer)
        // ============================================================================== //
        const configUrl = `${envConfig.BASE_URL}/v2/transactions/pay-in/config?country=EC`;
        const configResp = await axios.get(configUrl, {
            headers: { 'Authorization': `Bearer ${token}`, 'DisablePartnerMock': 'true' }
        });

        expect(configResp.status).toBe(200);

        // Extraer dinámicamente "qué fee_payer espera el sistema" (en vez de hardcodear)
        let dynamicFeePayer = "merchant"; // Fallback seguro
        const ecConfig = configResp.data.countries ? configResp.data.countries.find(c => c.country === 'EC') : null;
        if (ecConfig && ecConfig.payment_methods) {
            const bt = ecConfig.payment_methods.find(p => p.payment_method === 'bank_transfer');
            if (bt && bt.fee_payers && bt.fee_payers.length > 0) {
                // si el array trae 'merchant', 'customer', 'both'... escogemos el primero disponible que el Backend exija.
                dynamicFeePayer = bt.fee_payers[0];
            }
        }

        if (allure && allure.attachment) {
            await allure.attachment("Response Config EC (Fee Dinámico Evaluado)", JSON.stringify({ raw: configResp.data, seleccionado: dynamicFeePayer }, null, 2), "application/json");
        }

        // ============================================================================== //
        // 3. GENERAR LINK DE PAGO (POST /v2/pay-urls)
        // ============================================================================== //
        const myRefId = `PayUrl-EC-${Date.now()}`;
        const payUrlEndpoint = `${envConfig.BASE_URL}/v2/pay-urls`;
        const validPayload = {
            "country": "EC",
            "currency": "USD",
            "amount": payurlAmountConfig,
            // Quitamos el fee_payer inyectado visualmente para que Backend asuma su Default contable
            "merchant_transaction_reference": myRefId,
            "merchant_customer_id": "cliente_ec@ejemplo.com",
            "allowed_payment_methods": ["bank_transfer"],
            "predefined_fields": [
                {
                    "payment_method": "bank_transfer",
                    "fields": {
                        "first_name": "Sergio",
                        "last_name": "Test",
                        "email": "serrigo@paypaga.com",
                        "document_type": "CI",
                        "document_number": "1307990091"
                    }
                }
            ]
        };

        if (allure && allure.attachment) {
            await allure.attachment("Request Carga Feliz", JSON.stringify(validPayload, null, 2), "application/json");
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

        const trID = response.data.transaction_id;

        console.log(`\n🎉 Link de Pago Generado Correctamente [EC]: ${response.status}`);
        
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

        console.log("=== DEBUG TABLA PAYURL ===");
        console.log(tableContent);
        console.log("==========================");

        const hasRenderedAmmount = tableContent.includes('25.55') || tableContent.includes('25,55');
        expect(hasRenderedAmmount).toBe(true);

        // Capturamos ÚNICAMENTE la primera fila (la transacción actual) para acortar la imagen en el reporte.
        if (allure && allure.attachment) {
            const tableRowSnap = await page.locator('tbody tr').first().screenshot({ timeout: 5000 }).catch(() => null);
            if (tableRowSnap) await allure.attachment(`📸 Evidencia Visual Grilla: Transacción PayUrl Aislada`, tableRowSnap, "image/png");
        }

        const realGridTxId = await page.evaluate((ref) => {
            const rows = Array.from(document.querySelectorAll('tr'));
            const targetRow = rows.find(r => r.innerText.includes(ref) || r.innerText.includes('1,255.55') || r.innerText.includes('1255'));
            if (!targetRow) return null; // Si no encuentra fila
            
            const uuidRegex = /[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/;
            const match = targetRow.innerText.match(uuidRegex);
            return match ? match[0] : null;
        }, myRefId);

        // ============================================================================== //
        // 5. ADMIN PORTAL (APROBACIÓN AGIL UI)
        // ============================================================================== //
        await fastAdminApprove(page, realGridTxId || trID, 'pay-in', allure);

        // ============================================================================== //
        // 6. REGRESAR AL DASHBOARD Y VALIDAR IMPACTO
        // ============================================================================== //
        const finalBalances = await loginAndCaptureDashboard(page, allure, false);
        console.log("📈 SALDOS FINALES PAYURL TRAS APROBACIÓN:", finalBalances);

        expect(finalBalances.available).toBeGreaterThan(initialBalances.available);
        expect(finalBalances.volume).toBeGreaterThan(initialBalances.volume);
        expect(finalBalances.fees !== initialBalances.fees).toBeTruthy();
        expect(finalBalances.taxes !== initialBalances.taxes).toBeTruthy();

        if (allure && allure.attachment) {
            await allure.attachment(`Comparativa PayUrl EC E2E`, JSON.stringify({ SALDOS_INICIALES: initialBalances, SALDOS_FINALES: finalBalances }, null, 2), "application/json");
        }
    });

});
