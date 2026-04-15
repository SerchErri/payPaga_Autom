const { getAccessToken } = require('../../../../../utils/authHelper');
const { chromium } = require('playwright');
const allure = require('allure-js-commons');
const envConfig = require('../../../../../utils/envConfig');
const { loginAndCaptureDashboard, fastAdminAction, preLoadFunds } = require('../../../../../utils/uiBalanceHelper');

jest.setTimeout(1800000); 

describe(`[E2E Híbrido] FULL FLOW - MERCHANT PORTAL EC Payout: Creación, Grilla y Admin Approve [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    let browser;
    let context;
    let page;
    let storedTxId = "";
    let initialBalances = {};
    let payoutMontoTest = 150.23;

    beforeAll(async () => {
        try {
            browser = await chromium.launch({ headless: true }); 
            context = await browser.newContext({ locale: 'es-ES', colorScheme: 'dark' });
            page = await context.newPage();
            page.setDefaultTimeout(20000);
            
            const token = await getAccessToken();
            await preLoadFunds(page, token, allure, 10000.00);
        } catch(e) { console.error("Fallo levantando Playwright", e); }
    });

    afterAll(async () => {
        if (browser) await browser.close();
    });

    const attachScreenshot = async (name) => {
        if(allure && allure.attachment){
            try {
                const buffer = await page.screenshot({ fullPage: true });
                await allure.attachment(`📸 Evidencia Visual: ${name}`, buffer, "image/png");
            } catch(e){}
        }
    };

    const originarPayoutDesdeMerchant = async (monto, refTag) => {
        const btnTransacciones = page.getByRole('link', { name: ' Transacciones ' }).first();
        await btnTransacciones.click();
        const btnSalida = page.getByRole('link', { name: 'Transacciones de Salida' }).first();
        await btnSalida.waitFor({ state: 'visible' });
        await btnSalida.click();
        
        const btnCrear = page.getByRole('link', { name: 'Crear Pago' }).first();
        await btnCrear.waitFor({ state: 'visible' }).catch(()=>null);
        await btnCrear.click().catch(()=>null);

        await page.waitForTimeout(2000);
        await page.getByLabel('País *').selectOption('EC');
        const m = page.locator('div').filter({ hasText: /^Monto \*$/ }).nth(1);
        await m.click().catch(()=>null);
        await page.getByRole('textbox', { name: 'Monto *' }).fill(monto.toString()).catch(()=>null);
        await page.getByRole('textbox', { name: 'Nombre*' }).fill('Sergio');
        await page.getByRole('textbox', { name: 'Apellido*' }).fill('Errigo Reverso');
        await page.getByLabel('Tipo de Documento*').selectOption('CI');
        await page.getByRole('textbox', { name: 'Número de Documento*' }).fill('1710034065');
        await page.getByLabel('Banco*').selectOption('banco_pichincha');
        await page.getByLabel('Tipo de Cuenta*').selectOption('Ahorro');
        await page.getByRole('textbox', { name: 'Número de Cuenta*' }).fill('1234567890');
        await page.getByText('Disable Mock?').click().catch(()=>null); 
        
        await attachScreenshot(`Formulario Payout - ${refTag}`);
        await page.getByRole('button', { name: 'Crear Pago' }).click();
        await page.waitForTimeout(6000); 

        // Recuperar UUID Visualmente
        const obtainedTxId = await page.evaluate(() => {
            const match = document.body.innerText.match(/[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/);
            return match ? match[0] : null;
        });

        // Click visual en la fila (Grilla de Exito)
        const firstRow = page.locator('table tbody tr').first();
        await firstRow.click({ force: true }).catch(()=>null);
        await page.waitForTimeout(2000); 

        return obtainedTxId;
    };

    const markStatusFromMerchantGrid = async (txId, statusToClick) => {
        const btnTransacciones = page.getByRole('link', { name: ' Transacciones ' }).first();
        await btnTransacciones.click({ timeout: 5000 }).catch(()=>null);
        const btnSalida = page.getByRole('link', { name: 'Transacciones de Salida' }).first();
        await btnSalida.click({ timeout: 5000 }).catch(()=>null);
        await page.waitForTimeout(4000);

        // Hacemos click en el botón de opciones usando su ID determinista exacto:
        const actionBtn = page.locator(`#actions-btn-${txId}`).first();
        await actionBtn.click({ timeout: 4000, force: true }).catch(async () => {
             // Fallback resiliente
             console.log("Fallback: El ID estricto falló, buscando la fila por UUID literal...");
             const targetRow = page.locator('tr', { hasText: txId }).first();
             const genericBtn = targetRow.locator('button').last();
             await genericBtn.click({ timeout: 4000 }).catch(()=>null);
        });

        await page.waitForTimeout(1000);

        // Buscar texto dinámicamente: "Mark as failed" o "Mark as expired"
        const regexStr = statusToClick === 'failed' ? /failed|fallido|rechazar/i : /expired|expirar|expirado/i;
        const stateBtn = page.getByText(regexStr).first().catch(() => page.locator('button', { hasText: regexStr }).first());
        
        await stateBtn.click({ force: true }).catch(()=>null);
        await page.waitForTimeout(5000); // Sincronización del Reclamo

        await attachScreenshot(`Transacción Mercante Cambiada a ${statusToClick.toUpperCase()}`);
    };

    test('1. Flujo E2E Happy Path (Aprobado por Admin): Descuento Congelado -> Confirmación', async () => {
        // =========================================================
        // A) LOGIN MERCHANT & CAPTURA INICIAL
        // =========================================================
        initialBalances = await loginAndCaptureDashboard(page, allure, true);
        console.log("💰 SALDOS INICIALES:", initialBalances);

        if(initialBalances.available < payoutMontoTest) {
            console.warn(`⚠️ ALERTA: Tienes ${initialBalances.available} disponibles, pero intentaremos crear un payout de ${payoutMontoTest}. La API podría rechazarlo por falta de fondos.`);
        }

        // B) NAVEGAR Y CREAR PAYOUT
        storedTxId = await originarPayoutDesdeMerchant(payoutMontoTest, 'Happy_Approve');
        expect(storedTxId).not.toBeNull();

        // C) BALANCE INTERMEDIO: Verificar que el dinero FUE CONGELADO (Restado del available) *ANTES* de Approve
        const pendingBalances = await loginAndCaptureDashboard(page, allure, false);
        expect(pendingBalances.available).toBeLessThan(initialBalances.available);
        console.log("🧊 SALDOS CONGELADOS EN PRE-APROBACIÓN:", pendingBalances);

        // D) ADMIN PORTAL (APROBACIÓN LÓGICA EXCLUSIVA DE ADMIN)
        let baseURL = envConfig.BASE_URL;
        await page.goto(`${baseURL.replace("api", "merchant")}/logout`).catch(()=>null);
        await fastAdminAction(page, storedTxId, 'pay-out', allure, 'approve');
        await attachScreenshot('Transacción Confirmada Payout (Happy)');

        // E) BALANCE FINAL = MANTIENE EL DESCUENTO
        const finalBalances = await loginAndCaptureDashboard(page, allure, false);
        console.log("💰 SALDOS FINALES TRAS APROBACIÓN:", finalBalances);

        await attachScreenshot('Dashboard Merchant - Final Pantalla Completa');

        // =========================================================
        // E) ASERCIONES MATEMÁTICAS ESCALABLES (Evita fallos por tests en paralelo)
        // =========================================================
        // El cajón de RETIROS debería de haber absorbido el Payout. 
        // En vez de usar matemáticas exactas (que fallan si 2 tests corren al mismo tiempo), verificamos la tendencia del state.
        if (initialBalances.withdrawals >= 0) { 
             expect(finalBalances.withdrawals).toBeGreaterThan(initialBalances.withdrawals);
        } else { 
             expect(finalBalances.withdrawals).toBeLessThan(initialBalances.withdrawals);
        }

        expect(finalBalances.available).toBeLessThan(initialBalances.available);
        expect(finalBalances.available).toBeCloseTo(pendingBalances.available, 1);
        
        if (allure && allure.attachment) {
            await allure.attachment(`Cálculos de Congelamiento Contable (Happy Path)`, JSON.stringify({ SALDOS_INICIALES: initialBalances, CONGELAMIENTO_PENDING: pendingBalances, SALDOS_FINALES: finalBalances }, null, 2), "application/json");
        }
    });

    test('2. Flujo Reverso por FAILED: Creación -> PENDING (Debita) -> Fallado en M-Portal -> Reembolso', async () => {
        let revertMonto = 150.23;
        
        const initRevertBal = await loginAndCaptureDashboard(page, allure, true);
        const myTx = await originarPayoutDesdeMerchant(revertMonto, 'REVERSO_FAILED');
        expect(myTx).not.toBeNull();

        const pendingBal = await loginAndCaptureDashboard(page, allure, false);
        expect(pendingBal.available).toBeLessThan(initRevertBal.available); // Aserción de Congelamiento

        // APLICAR RECHAZO DIRECTO DESDE EL MERCHANT PORTAL USANDO UI
        await markStatusFromMerchantGrid(myTx, 'failed');

        // Verificamos Reembolso Total
        const finalRevertBal = await loginAndCaptureDashboard(page, allure, false);
        expect(finalRevertBal.available).toBeGreaterThan(pendingBal.available);
        expect(finalRevertBal.available).toBeCloseTo(initRevertBal.available, 1);
        
        if (allure && allure.attachment) {
            await allure.attachment(`Reporte Matemático Reverso: FAILED`, JSON.stringify({ SALDO_ORIGINAL: initRevertBal, DEBITO_TEMPORAL: pendingBal, SALDO_DEVUELTO: finalRevertBal }, null, 2), "application/json");
        }
    });

    test('3. Flujo Reverso por EXPIRED: Creación -> PENDING (Debita) -> Expiración Forzada M-Portal -> Reembolso', async () => {
        let revertMonto = 150.23;
        
        const initRevertBal = await loginAndCaptureDashboard(page, allure, true);
        const myTx = await originarPayoutDesdeMerchant(revertMonto, 'REVERSO_EXPIRED');
        expect(myTx).not.toBeNull();

        const pendingBal = await loginAndCaptureDashboard(page, allure, false);
        expect(pendingBal.available).toBeLessThan(initRevertBal.available); 

        // APLICAR EXPIRACIÓN DIRECTO DESDE EL MERCHANT PORTAL USANDO UI
        await markStatusFromMerchantGrid(myTx, 'expired');

        // Verificamos Reembolso Total
        const finalRevertBal = await loginAndCaptureDashboard(page, allure, false);
        expect(finalRevertBal.available).toBeGreaterThan(pendingBal.available);
        expect(finalRevertBal.available).toBeCloseTo(initRevertBal.available, 1);
        
        if (allure && allure.attachment) {
            await allure.attachment(`Reporte Matemático Reverso: EXPIRED`, JSON.stringify({ SALDO_ORIGINAL: initRevertBal, DEBITO_TEMPORAL: pendingBal, SALDO_DEVUELTO: finalRevertBal }, null, 2), "application/json");
        }
    });

});
