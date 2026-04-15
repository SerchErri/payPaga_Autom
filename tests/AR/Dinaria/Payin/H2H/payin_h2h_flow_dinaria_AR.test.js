const axios = require('axios');
const allure = require('allure-js-commons');
const { chromium } = require('playwright');
const { getAccessToken } = require('../../../../../utils/authHelper');
const envConfig = require('../../../../../utils/envConfig');
const { loginAndCaptureDashboard, fastAdminApprove } = require('../../../../../utils/uiBalanceHelper');

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
        initialBalances = await loginAndCaptureDashboard(page, allure, true);
        console.log("📈 SALDOS INICIALES PAYIN (UI):", initialBalances);

        // ============================================================================== //
        // 2. OBTENER INFORMACIÓN DEL MÉTODO DE PAGO para ARGENTINA (AR) 
        // ============================================================================== //
        const configUrl = `${envConfig.BASE_URL}/v2/transactions/pay-in/config?country=AR`;

        const configResponse = await axios.get(configUrl, {
            headers: {
                'DisablePartnerMock': 'true',
                'Authorization': `Bearer ${token}`
            },
            validateStatus: () => true
        });

        if (configResponse.status !== 200) {
            console.error('El endpoint del GET Config AR falló:', JSON.stringify(configResponse.data, null, 2));
        }
        expect(configResponse.status).toBe(200);

        if (allure && allure.attachment) {
            await allure.attachment(
                `Paso 2 - Respuesta Config AR [${envConfig.currentEnvName.toUpperCase()}]`,
                JSON.stringify(configResponse.data, null, 2),
                "application/json"
            );
        }

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
                "first_name": "João",
                "last_name": "Silva",
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
        await btnTransacciones.click({ force: true }).catch(()=>null);
        await page.waitForTimeout(1000);
        
        const btnEntradas = page.getByRole('link', { name: 'Transacciones de Entrada' }).first();
        await btnEntradas.click({ force: true }).catch(()=>null);
        
        await page.waitForTimeout(8000); // Dar holgura a la carga de la tabla armada por React

        // Si la tabla contiene el amount gigante, significa que cayó exitosamente a nivel UI
        const tableContent = await page.locator('table').innerText().catch(async () => await page.innerText('body').catch(()=>""));
        
        console.log("=== DEBUG TABLA PAYIN H2H ===");
        console.log(tableContent);
        console.log("=============================");

        const hasRenderedAmmount = tableContent.includes('1000') || tableContent.includes('1.000');
        expect(hasRenderedAmmount).toBe(true); // La UI procesó el webhook exitosamente

        if (allure && allure.attachment) {
            const tableSnap = await page.locator('table').screenshot({ timeout: 5000 }).catch(() => null);
            if (tableSnap) await allure.attachment(`📸 Evidencia Visual Grilla: Transacción H2H aterrizó en UI`, tableSnap, "image/png");
        }

        // ============================================================================== //
        // 5. ADMIN PORTAL (APROBACIÓN AGIL UI)
        // ============================================================================== //
        await fastAdminApprove(page, trID, 'pay-in', allure);

        // ============================================================================== //
        // 6. REGRESAR AL DASHBOARD Y VALIDAR IMPACTO
        // ============================================================================== //
        const finalBalances = await loginAndCaptureDashboard(page, allure, false);
        console.log("📈 SALDOS FINALES PAYIN TRAS APROBACIÓN H2H:", finalBalances);

        // Validaciones Tolerantes al Paralelismo
        expect(finalBalances.available).toBeGreaterThan(initialBalances.available);
        expect(finalBalances.volume).toBeGreaterThan(initialBalances.volume);
        expect(finalBalances.fees !== initialBalances.fees).toBeTruthy();
        expect(finalBalances.taxes !== initialBalances.taxes).toBeTruthy();

        if (allure && allure.attachment) {
            await allure.attachment(`Comparativa PayIn AR Dinaria H2H`, JSON.stringify({ SALDOS_INICIALES: initialBalances, SALDOS_FINALES: finalBalances }, null, 2), "application/json");
        }
    });

});
