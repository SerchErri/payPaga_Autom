const axios = require('axios');
const allure = require('allure-js-commons');
const { chromium } = require('playwright');
const { getAccessToken } = require('../../../../../utils/authHelper');
const envConfig = require('../../../../../utils/envConfig');
const { loginAndCaptureDashboard, fastAdminApprove } = require('../../../../../utils/uiBalanceHelper');

describe(`[E2E Híbrido] Payout H2H Ecuador: API Generación + UI Validaciones [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    let token = '';
    let browser;
    let context;
    let page;
    let initialBalances = {};
    let payoutAmount = 15.23; // Fijo para aserciones matemáticas

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

    // Tiempo global ultra amplio para UI
    jest.setTimeout(1800000); 

    test('Flujo Ómnicanal: UI Saldos -> API Payout H2H -> Admin Approve -> UI Impacto', async () => {
        // ==========================================
        // 1. OBTENER SALDO DEL DASHBOARD UI (Sincronización Híbrida)
        // ==========================================
        initialBalances = await loginAndCaptureDashboard(page, allure, true);
        console.log("💰 SALDOS INICIALES (UI Merchant):", initialBalances);

        if(initialBalances.available < payoutAmount) {
            console.warn(`⚠️ ALERTA: Tienes ${initialBalances.available} disponibles. Probablemente falle la API por falta de fondos.`);
        }
        // ==========================================
        // 2. EJECUTAR PAYOUT HTTP POST (Puro API)
        // ==========================================
        const payoutUrl = `${envConfig.BASE_URL}/payout`;
        const referenceId = `H2H-Payout-${Date.now()}`;
        const payload = {
            country_code: 'EC',
            currency: 'USD',
            payment_method_code: 'bank_transfer',
            transaction: {
                beneficiary: {
                    first_name: 'Serch',
                    last_name: 'Test',
                    document_type: 'CI',
                    document_number: '1710034065',
                    account_number: '1234567891',
                    bank_code: 'coop_ahorro_y_credito_el_sagrario',
                    account_type: 'ahorro',
                },
                transaction_data: {
                    payout_concept: 'Validacion Happy Path Payout',
                    merchant_transaction_reference: referenceId,
                    transaction_total: payoutAmount,
                },
            },
        };

        // ==========================================
        // 3. EJECUTAR PAYOUT HTTP POST
        // ==========================================
        const res = await axios.post(payoutUrl, payload, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'DisablePartnerMock': 'true',
            },
            validateStatus: () => true,
        });

        if (allure && allure.attachment) {
            await allure.attachment('Payout H2H Enviado', JSON.stringify(payload, null, 2), 'application/json');
            await allure.attachment('Respuesta Payout', JSON.stringify(res.data, null, 2), 'application/json');
        }

        // ==========================================
        // 3. VALIDAR H2H RESPONSE Y EXTRAER ID
        // ==========================================
        expect([200, 201]).toContain(res.status);
        expect(res.data).toBeDefined();

        console.log("=== API RESPONSE PAYOUT H2H ===", JSON.stringify(res.data, null, 2));

        const resData = res.data;
        let generatedTxId = "UNKNOWN";
        if (resData.details && resData.details.transaction_processed && resData.details.transaction_processed.transaction_id) {
            generatedTxId = resData.details.transaction_processed.transaction_id;
        } else if (resData.transaction_id || resData.id) {
            generatedTxId = resData.transaction_id || resData.id;
        }
        
        expect(generatedTxId).not.toBe("UNKNOWN");
        if (allure && allure.attachment) {
            await allure.attachment('🔗 Operation Transaction ID Extracted', `H2H Payout ID Recibido por API:\n\n${generatedTxId}`, 'text/plain');
        }

        // ==========================================
        // 4. INSPECCIONAR GRILLA VISUALMENTE COMO EVIDENCIA
        // ==========================================
        await page.bringToFront();

        const btnTransacciones = page.getByRole('link', { name: ' Transacciones ' }).first();
        await btnTransacciones.click({ force: true }).catch(()=>null);
        await page.waitForTimeout(1000);
        
        const btnSalidas = page.getByRole('link', { name: 'Transacciones de Salida' }).first();
        await btnSalidas.click({ force: true }).catch(()=>null);
        
        await page.waitForTimeout(8000); // Dar tiempo a sockets y render

        const tableContent = await page.locator('table').innerText().catch(async () => await page.innerText('body').catch(()=>""));
        
        console.log("=== DEBUG TABLA PAYOUT H2H ===");
        console.log(tableContent);
        console.log("==============================");

        const hasRenderedAmmount = tableContent.includes('15.23') || tableContent.includes('15,23');
        expect(hasRenderedAmmount).toBe(true);

        if (allure && allure.attachment) {
            const tableRowSnap = await page.locator('tbody tr').first().screenshot({ timeout: 5000 }).catch(() => null);
            if(tableRowSnap) await allure.attachment(`📸 Evidencia Visual Grilla: Payout H2H Aislado`, tableRowSnap, "image/png");
        }

        const realGridTxId = await page.evaluate((ref) => {
            const rows = Array.from(document.querySelectorAll('tr'));
            const targetRow = rows.find(r => r.innerText.includes(ref) || r.innerText.includes('15.23') || r.innerText.includes('15,23'));
            if (!targetRow) return null; // Si no lo encuentra cae directo al api response ID
            
            const uuidRegex = /[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/;
            const match = targetRow.innerText.match(uuidRegex);
            return match ? match[0] : null;
        }, referenceId);

        // ==========================================
        // 5. ADMIN PORTAL (APROBACIÓN AGIL UI)
        // ==========================================
        await fastAdminApprove(page, realGridTxId || generatedTxId, 'pay-out', allure);

        // ==========================================
        // 6. REGRESAR AL DASHBOARD Y VALIDAR IMPACTO
        // ==========================================
        const finalBalances = await loginAndCaptureDashboard(page, allure, false);
        console.log("💰 SALDOS FINALES TRAS APROBACIÓN H2H:", finalBalances);

        // Retiros suben, el Disponible baja. (Escalable y tolerante a paralelismo)
        if (initialBalances.withdrawals >= 0) { 
            expect(finalBalances.withdrawals).toBeGreaterThan(initialBalances.withdrawals);
        } else { 
            expect(finalBalances.withdrawals).toBeLessThan(initialBalances.withdrawals);
        }

        expect(finalBalances.available).toBeLessThan(initialBalances.available);
        expect(finalBalances.fees !== undefined).toBeTruthy();
        expect(finalBalances.taxes !== undefined).toBeTruthy();

        if (allure && allure.attachment) {
            await allure.attachment(`Cálculo y Auditoría H2H (Protección Paralela)`, JSON.stringify({ 
                SITUACION_INICIAL: initialBalances, 
                SITUACION_FINAL: finalBalances, 
                MONTO_H2H_PROCESADO: payoutAmount 
            }, null, 2), "application/json");
        }
    });
});
