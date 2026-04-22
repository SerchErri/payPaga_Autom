const axios = require('axios');
const allure = require('allure-js-commons');
const { chromium } = require('playwright');
const { getAccessToken } = require('../../../../../utils/authHelper');
const envConfig = require('../../../../../utils/envConfig');
const { loginAndCaptureDashboard, fastAdminAction, preLoadFunds } = require('../../../../../utils/uiBalanceHelper');

describe(`[E2E Híbrido] Payout H2H Argentina: API Generación + UI Validaciones [Amb: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    let token = '';
    let browser;
    let context;
    let page;
    let initialBalances = {};
    let payoutAmount = 2500.50; // Fijo para aserciones matemáticas (ARS)

    beforeAll(async () => {
        token = await getAccessToken();
        try {
            browser = await chromium.launch({ headless: true });
            context = await browser.newContext({ locale: 'es-ES', colorScheme: 'dark' });
            page = await context.newPage();
            page.setDefaultTimeout(20000);
            await preLoadFunds(page, token, allure, 100000.00, 'AR');
        } catch (e) { console.error("Fallo levantando Playwright", e); }
    });

    afterAll(async () => {
        if (browser) await browser.close();
    });

    // Tiempo global ultra amplio para UI
    jest.setTimeout(1800000);

    const attachScreenshot = async (name) => {
        if (allure && allure.attachment) {
            try {
                const buffer = await page.screenshot({ fullPage: true });
                await allure.attachment(`📸 Evidencia Visual: ${name}`, buffer, "image/png");
            } catch (e) { }
        }
    };

    const originarPayoutH2H = async (monto, refTag) => {
        const payoutUrl = `${envConfig.BASE_URL}/v2/transactions/pay-out`;
        const payload = {
            amount: monto,
            country: 'AR', 
            currency: 'ARS', 
            payment_method: 'cvu',
            merchant_order_reference: `PoUrl-${refTag}-${Date.now()}`,
            merchant_transaction_reference: `PoUrl-${refTag}-${Date.now()}`,
            merchant_customer_id: 'customer@email.com',
            customer_ip: "120.29.48.92",
            fields: {
                first_name: 'Sergio', 
                last_name: 'Test',
                document_number: '20275105792', 
                account_number: '0070327530004025541644'
            }
        };
        const res = await axios.post(payoutUrl, payload, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'DisablePartnerMock': 'true' },
            validateStatus: () => true
        });

        const txId = res.data.transaction_id || res.data.id || (res.data.details && res.data.details.transaction_processed && res.data.details.transaction_processed.transaction_id);
        if (allure && allure.attachment) {
            await allure.attachment(`Payout H2H Emitido (ID: ${txId})`, JSON.stringify(res.data, null, 2), "application/json");
        }
        return txId;
    };

    const markStatusFromMerchantGrid = async (txId, statusToClick) => {
        const btnTransacciones = page.getByRole('link', { name: ' Transacciones ' }).first();
        await btnTransacciones.click({ timeout: 5000 }).catch(() => null);
        const btnSalida = page.getByRole('link', { name: 'Transacciones de Salida' }).first();
        await btnSalida.click({ timeout: 5000 }).catch(() => null);
        await page.waitForTimeout(4000);

        const targetRow = page.locator('tr', { hasText: txId }).first();
        const actionBtn = targetRow.getByRole('button', { name: /Action|Acciones/i }).first();
        await actionBtn.click({ timeout: 4000 }).catch(async () => {
            const genericBtn = targetRow.locator('button').last();
            await genericBtn.click({ timeout: 4000 }).catch(() => null);
        });

        await page.waitForTimeout(1000);
        const regexStr = statusToClick === 'failed' ? /failed|fallido|rechazar/i : /expired|expirar|expirado/i;
        const stateBtn = page.locator('button').filter({ hasText: regexStr }).first();
        await stateBtn.click({ force: true }).catch(() => null);
        await page.waitForTimeout(5000);

        await attachScreenshot(`H2H Mercante Cambiado a ${statusToClick.toUpperCase()}`);
    };

    test('1. Flujo Ómnicanal Happy Path: UI Saldos -> API Payout H2H -> Visto en M-Portal -> Admin Approve', async () => {
        // ==========================================
        // 1. OBTENER SALDO DEL DASHBOARD UI (Sincronización Híbrida)
        // ==========================================
        initialBalances = await loginAndCaptureDashboard(page, allure, true, 'AR');
        console.log("💰 SALDOS INICIALES (UI Merchant):", initialBalances);

        if (initialBalances.available < payoutAmount) {
            console.warn(`⚠️ ALERTA: Tienes ${initialBalances.available} disponibles. Probablemente falle la API por falta de fondos.`);
        }
        // B) EJECUTAR PAYOUT HTTP POST
        const generatedTxId = await originarPayoutH2H(payoutAmount, 'APPROVE');
        expect(generatedTxId).not.toBeNull();

        // C) BALANCE INTERMEDIO: Verificar congelamiento de fondos (PENDING)
        const pendingBalances = await loginAndCaptureDashboard(page, allure, false, 'AR');
        expect(pendingBalances.available).toBeLessThan(initialBalances.available);
        console.log("🧊 SALDOS CONGELADOS EN PRE-APROBACIÓN (H2H):", pendingBalances);

        // D) INSPECCIONAR GRILLA VISUALMENTE COMO EVIDENCIA
        await page.bringToFront();
        const btnTransacciones = page.getByRole('link', { name: ' Transacciones ' }).first();
        await btnTransacciones.click({ force: true }).catch(() => null);
        await page.waitForTimeout(1000);
        const btnSalidas = page.getByRole('link', { name: 'Transacciones de Salida' }).first();
        await btnSalidas.click({ force: true }).catch(() => null);
        await page.waitForTimeout(6000);

        if (allure && allure.attachment) {
            const tableRowSnap = await page.locator('tbody tr').first().screenshot({ timeout: 5000 }).catch(() => null);
            if (tableRowSnap) await allure.attachment(`📸 Evidencia Visual Grilla: Payout H2H Aislado`, tableRowSnap, "image/png");
        }

        // ==========================================
        // 5. ADMIN PORTAL (APROBACIÓN AGIL UI)
        // ==========================================
        await fastAdminAction(page, generatedTxId, 'pay-out', allure, 'approve');

        // ==========================================
        // 6. REGRESAR AL DASHBOARD Y VALIDAR IMPACTO
        // ==========================================
        const finalBalances = await loginAndCaptureDashboard(page, allure, false, 'AR');
        console.log("💰 SALDOS FINALES TRAS APROBACIÓN H2H:", finalBalances);

        // Retiros suben, el Disponible baja. (Escalable y tolerante a paralelismo)
        if (initialBalances.withdrawals >= 0) {
            expect(finalBalances.withdrawals).toBeGreaterThan(initialBalances.withdrawals);
        } else {
            expect(finalBalances.withdrawals).toBeLessThan(initialBalances.withdrawals);
        }

        expect(finalBalances.available).toBeLessThan(initialBalances.available);
        expect(finalBalances.available).toBeCloseTo(pendingBalances.available, 1);
        expect(finalBalances.fees !== undefined).toBeTruthy();
        expect(finalBalances.taxes !== undefined).toBeTruthy();

        if (allure && allure.attachment) {
            await allure.attachment(`Cálculo y Auditoría H2H (Protección Paralela)`, JSON.stringify({
                SITUACION_INICIAL: initialBalances,
                CONGELAMIENTO_PENDING: pendingBalances,
                SITUACION_FINAL: finalBalances,
                MONTO_H2H_PROCESADO: payoutAmount
            }, null, 2), "application/json");
        }
    });

    test('2. Flujo Reverso H2H por FAILED: Generación API -> PENDING -> Dropdown Merchant (Failed) -> Reembolso', async () => {
        let revertMonto = 2500.50;

        const initRevertBal = await loginAndCaptureDashboard(page, allure, true, 'AR');
        const myTx = await originarPayoutH2H(revertMonto, 'REVERSO_FAILED');
        expect(myTx).not.toBeNull();

        const pendingBal = await loginAndCaptureDashboard(page, allure, false, 'AR');
        expect(pendingBal.available).toBeLessThan(initRevertBal.available);

        // APLICAR RECHAZO DIRECTO DESDE EL MERCHANT PORTAL
        await markStatusFromMerchantGrid(myTx, 'failed');

        // Verificamos Reembolso Total
        const finalRevertBal = await loginAndCaptureDashboard(page, allure, false, 'AR');
        expect(finalRevertBal.available).toBeGreaterThan(pendingBal.available);
        expect(finalRevertBal.available).toBeCloseTo(initRevertBal.available, 1);

        if (allure && allure.attachment) {
            await allure.attachment(`Reporte Matemático Reverso H2H: FAILED`, JSON.stringify({ SALDO_ORIGINAL: initRevertBal, DEBITO_TEMPORAL: pendingBal, SALDO_DEVUELTO: finalRevertBal }, null, 2), "application/json");
        }
    });

    test('3. Flujo Reverso H2H por EXPIRED: Generación API -> PENDING -> Dropdown Merchant (Expired) -> Reembolso', async () => {
        let revertMonto = 2500.50;

        const initRevertBal = await loginAndCaptureDashboard(page, allure, true, 'AR');
        const myTx = await originarPayoutH2H(revertMonto, 'REVERSO_EXPIRED');
        expect(myTx).not.toBeNull();

        const pendingBal = await loginAndCaptureDashboard(page, allure, false, 'AR');
        expect(pendingBal.available).toBeLessThan(initRevertBal.available);

        // APLICAR EXPIRACIÓN DIRECTO DESDE EL MERCHANT PORTAL
        await markStatusFromMerchantGrid(myTx, 'expired');

        // Verificamos Reembolso Total
        const finalRevertBal = await loginAndCaptureDashboard(page, allure, false, 'AR');
        expect(finalRevertBal.available).toBeGreaterThan(pendingBal.available);
        expect(finalRevertBal.available).toBeCloseTo(initRevertBal.available, 1);

        if (allure && allure.attachment) {
            await allure.attachment(`Reporte Matemático Reverso H2H: EXPIRED`, JSON.stringify({ SALDO_ORIGINAL: initRevertBal, DEBITO_TEMPORAL: pendingBal, SALDO_DEVUELTO: finalRevertBal }, null, 2), "application/json");
        }
    });

});
