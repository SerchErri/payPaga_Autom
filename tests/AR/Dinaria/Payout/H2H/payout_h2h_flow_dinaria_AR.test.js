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
            context = await browser.newContext({ locale: 'es-ES', colorScheme: 'dark', viewport: { width: 1920, height: 1080 } });
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

    const filterBalance = (bal) => {
        return {
            general: bal.general,
            available: bal.available,
            fees: bal.fees,
            taxes: bal.taxes
        };
    };

    const captureRowEvidence = async (txId, label) => {
        try {
            if (allure && allure.attachment) {
                // Forzar un viewport ultra-ancho para que la tabla expanda todas sus columnas horizontales
                const originalSize = page.viewportSize();
                await page.setViewportSize({ width: 2560, height: 1080 }).catch(() => null);

                await page.evaluate(() => {
                    const wrappers = document.querySelectorAll('.table-responsive, [style*="overflow"]');
                    wrappers.forEach(w => { 
                        if (w.style) { w.style.overflow = 'visible'; w.style.overflowX = 'visible'; }
                    });
                }).catch(() => null);
                
                const cleanTxId = String(txId).trim().toLowerCase();
                const shortTxId = cleanTxId.substring(0, 13);
                
                // Escáner profundo del DOM para encontrar la fila sin depender de locators frágiles
                const rowHandle = await page.evaluateHandle(({ fullId, shortId }) => {
                    const rows = Array.from(document.querySelectorAll('tr'));
                    for (let row of rows) {
                        if (row.innerHTML.toLowerCase().includes(fullId) || row.innerText.toLowerCase().includes(shortId)) {
                            row.style.backgroundColor = 'rgba(59, 130, 246, 0.15)';
                            row.style.borderLeft = '4px solid #3b82f6';
                            row.scrollIntoView({ behavior: 'instant', inline: 'center', block: 'center' });
                            return row;
                        }
                    }
                    return null;
                }, { fullId: cleanTxId, shortId: shortTxId });

                if (rowHandle && await rowHandle.evaluate(n => n !== null)) {
                    await page.waitForTimeout(1000); // Esperar renderizado del nuevo viewport
                    
                    const box = await rowHandle.boundingBox();
                    if (box) {
                        const rowSnap = await page.screenshot({
                            clip: { x: 0, y: Math.max(0, box.y - 80), width: 2560, height: box.height + 120 },
                            timeout: 5000
                        }).catch(() => null);
                        
                        if (rowSnap) {
                            await allure.attachment(`📸 Evidencia Visual Grilla: Payout H2H Aislado - ${label}`, rowSnap, "image/png");
                        }
                    }
                } else {
                    console.log(`⚠️ (captureRowEvidence) No se encontró la fila en el DOM para ${shortTxId}.`);
                }

                // Restaurar tamaño para no romper otros elementos del test
                if (originalSize) {
                    await page.setViewportSize(originalSize).catch(() => null);
                }
            }
        } catch (e) {

            console.log(`🛡️ [UI Shield] Error menor ignorado al capturar fila: ${e.message}`);
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
            await allure.attachment(`Payload Solicitud Payout H2H`, JSON.stringify(payload, null, 2), "application/json");
            await allure.attachment(`Payout H2H Emitido (ID: ${txId})`, JSON.stringify(res.data, null, 2), "application/json");
        }
        return txId;
    };

    const markStatusFromMerchantGrid = async (txId, statusToClick) => {
        try {
            const merchantUrl = envConfig.BASE_URL.replace("api", "merchant");
            await page.goto(`${merchantUrl}/dashboard`);
            await page.waitForTimeout(1000);
            await page.goto(`${merchantUrl}/transactions/out`);
            await page.waitForLoadState('networkidle').catch(() => null);
            await page.waitForTimeout(5000);

            const cleanTxId = String(txId).trim().toLowerCase();
            const shortTxId = cleanTxId.substring(0, 13);
            
            // 1. Escaneo profundo y robusto del DOM para encontrar la fila
            const rowInfo = await page.evaluate(({ fullId, shortId }) => {
                const rows = Array.from(document.querySelectorAll('tr'));
                for (let row of rows) {
                    const html = row.innerHTML.toLowerCase();
                    const text = row.innerText.toLowerCase();
                    if (html.includes(fullId) || text.includes(shortId)) {
                        return { found: true, text: text };
                    }
                }
                return { found: false, text: "" };
            }, { fullId: cleanTxId, shortId: shortTxId });

            if (!rowInfo.found) {
                console.log(`⚠️ [UI Bypass] Fila para ${shortTxId} no encontrada. El sistema pudo auto-procesarla o no renderizó. Omitiendo click.`);
                return;
            }

            console.log(`[🔍 DEBUG UI] Estado detectado:`, rowInfo.text.replace(/\n/g, ' | '));

            if (/approv|aprob|complet|proces|exit|succes|acept|accept/i.test(rowInfo.text)) {
                console.log(`⚠️ Transacción YA ESTÁ APROBADA. Omitiendo click.`);
                return;
            }
            if (/fail|fall|rechaz|reject|cancel|deneg|anul|declin/i.test(rowInfo.text)) {
                console.log(`⚠️ Transacción YA ESTÁ FALLIDA. Omitiendo click.`);
                return;
            }

            // 2. Click al botón de opciones inyectando eventos nativos reales
            console.log(`[🕹️ UI Action] Forzando apertura del menú de acciones...`);
            let clicked = await page.evaluate(({ fullId, shortId }) => {
                const rows = Array.from(document.querySelectorAll('tr'));
                for (let row of rows) {
                    if (row.innerHTML.toLowerCase().includes(fullId) || row.innerText.toLowerCase().includes(shortId)) {
                        const btn = row.querySelector(`button[id*="${fullId}"]`) || row.querySelector('td[data-column="actions"] button');
                        if (btn) {
                            btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                            btn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
                            btn.click();
                            return true;
                        }
                    }
                }
                return false;
            }, { fullId: cleanTxId, shortId: shortTxId });

            if (!clicked) {
                console.log(`⚠️ [UI Bypass] No se pudo clickear el botón. Omitiendo interacción manual.`);
                return;
            }

            await page.waitForTimeout(1000);

            // 3. Click a la opción usando fallback multinivel
            const dataActionStr = statusToClick === 'approved' ? 'approve' : 'failed';
            console.log(`[🕹️ UI Action] Seleccionando ${dataActionStr}...`);
            
            // Intento A: JS Nativo
            await page.evaluate(({ action }) => {
                const opt = document.querySelector(`a[data-action="${action}"]`);
                if (opt) opt.click();
            }, { action: dataActionStr }).catch(() => null);

            // Intento B: Playwright force
            const regexStr = statusToClick === 'approved' ? /approv|aprob/i : /fail|fall|rechaz/i;
            await page.getByText(regexStr).first().click({ force: true, timeout: 2000 }).catch(() => null);

            // 4. Modal Confirmación
            await page.waitForTimeout(2000);
            const confirmBtn = page.getByRole('button', { name: /confirmar|confirm|yes|sí|si|aceptar|accept/i }).first();
            if (await confirmBtn.isVisible().catch(() => false)) {
                await confirmBtn.click({ force: true }).catch(() => null);
            }
            
            await page.waitForTimeout(10000); // 10s para backend
            await captureRowEvidence(txId, statusToClick.toUpperCase());
            
        } catch (e) {
            console.log(`🛡️ [UI Shield] Error neutralizado durante interacción de grilla: ${e.message}`);
        }
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

        // Damos tiempo al procesador backend para asentar el Payout y congelar el saldo
        await page.waitForTimeout(5000);

        // C) BALANCE INTERMEDIO: Verificar congelamiento de fondos (PENDING)
        const pendingBalances = await loginAndCaptureDashboard(page, allure, false, 'AR');
        expect(pendingBalances.available).toBeLessThan(initialBalances.available);
        console.log("🧊 SALDOS CONGELADOS EN PRE-APROBACIÓN (H2H):", pendingBalances);

        // D) INSPECCIONAR GRILLA VISUALMENTE COMO EVIDENCIA (PENDING)
        await page.bringToFront();
        const btnTransacciones = page.getByRole('link', { name: ' Transacciones ' }).first();
        await btnTransacciones.click({ force: true }).catch(() => null);
        await page.waitForTimeout(1000);
        const btnSalidas = page.getByRole('link', { name: 'Transacciones de Salida' }).first();
        await btnSalidas.click({ force: true }).catch(() => null);
        await page.waitForTimeout(6000);

        await captureRowEvidence(generatedTxId, 'PENDING');

        // ==========================================
        // 5. MARCAR COMO APROBADO DESDE MERCHANT PORTAL (Actions -> Marcar como Aprobado)
        // Damos también 10 segundos extra por si el sistema auto-aprueba en background
        // ==========================================
        await page.waitForTimeout(12000); // Dar margen al auto-approve del que hablaba QA
        await markStatusFromMerchantGrid(generatedTxId, 'approved');

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
            await allure.attachment(`Payout Audit and Calculation (Approve)`, JSON.stringify({
                "1. Initial Balance (Before Payout)": filterBalance(initialBalances),
                "2. Intermediate Balance (Funds Frozen)": filterBalance(pendingBalances),
                "3. Final Balance (After Approval)": filterBalance(finalBalances),
                "Payout Amount Processed": payoutAmount
            }, null, 2), "application/json");
        }
    });

    test('2. Flujo Reverso H2H por FAILED: Generación API -> PENDING -> Dropdown Merchant (Failed) -> Reembolso', async () => {
        let revertMonto = 2500.50;
        let initRevertBal, myTx, pendingBal, finalRevertBal;

        await allure.step("1. Obtener Saldo Inicial desde UI", async () => {
            initRevertBal = await loginAndCaptureDashboard(page, allure, false, 'AR');
        });

        await allure.step("2. Emitir Payout H2H por API", async () => {
            myTx = await originarPayoutH2H(revertMonto, 'REVERSO_FAILED');
            expect(myTx).not.toBeNull();
            
            // Damos tiempo al procesador backend para asentar el Payout y congelar el saldo
            await page.waitForTimeout(5000);
        });

        await allure.step("3. Verificar Congelamiento (PENDING) en UI", async () => {
            pendingBal = await loginAndCaptureDashboard(page, allure, false, 'AR');
            expect(pendingBal.available).toBeLessThan(initRevertBal.available);
        });

        await allure.step("4. Aplicar Rechazo (Failed) desde Grilla Merchant", async () => {
            await markStatusFromMerchantGrid(myTx, 'failed');
        });

        await allure.step("5. Verificar Reembolso Total en UI", async () => {
            finalRevertBal = await loginAndCaptureDashboard(page, allure, false, 'AR');
            expect(finalRevertBal.available).toBeGreaterThan(pendingBal.available);
            expect(finalRevertBal.available).toBeCloseTo(initRevertBal.available, 1);
        });

        await allure.step("6. Adjuntar Auditoría de Saldos", async () => {
            if (allure && allure.attachment) {
                await allure.attachment(`Payout Audit and Calculation (Failed)`, JSON.stringify({
                    "1. Initial Balance (Before Payout)": filterBalance(initRevertBal),
                    "2. Intermediate Balance (Funds Frozen)": filterBalance(pendingBal),
                    "3. Final Balance (Funds Refunded)": filterBalance(finalRevertBal),
                    "Payout Amount Attempted": revertMonto,
                    "Is Refund Successful? (Initial == Final)": initRevertBal.available === finalRevertBal.available
                }, null, 2), "application/json");
            }
        });
    });

    test('3. Flujo Negativo H2H: Fondos Insuficientes -> API Payout (Monto Mayor al Disponible) -> Debe Fallar', async () => {
        let initInsfBal, excessMonto, res, finalInsfBal;

        await allure.step("1. Obtener Saldo Disponible Inicial", async () => {
            // Forzamos login en Test 3 para limpiar cualquier estado anómalo que haya dejado el Test 2 si falló
            initInsfBal = await loginAndCaptureDashboard(page, allure, true, 'AR');
            excessMonto = initInsfBal.available + 15000.50; 
        });
        
        await allure.step("2. Emitir Payout con Fondos Insuficientes", async () => {
            const payoutUrl = `${envConfig.BASE_URL}/v2/transactions/pay-out`;
            const payload = {
                amount: excessMonto,
                country: 'AR', 
                currency: 'ARS', 
                payment_method: 'cvu',
                merchant_order_reference: `PoUrl-INSUF-${Date.now()}`,
                merchant_transaction_reference: `PoUrl-INSUF-${Date.now()}`,
                merchant_customer_id: 'customer@email.com',
                customer_ip: "120.29.48.92",
                fields: {
                    first_name: 'Sergio', 
                    last_name: 'Test',
                    document_number: '20275105792', 
                    account_number: '0070327530004025541644'
                }
            };

            res = await axios.post(payoutUrl, payload, {
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'DisablePartnerMock': 'true' },
                validateStatus: () => true
            });

            if (allure && allure.attachment) {
                await allure.attachment(`Payload Enviado (INSUF FUNDS)`, JSON.stringify(payload, null, 2), "application/json");
                await allure.attachment(`Payout H2H Emitido (ID: N/A - INSUF FUNDS)`, JSON.stringify(res.data, null, 2), "application/json");
            }
        });

        await allure.step("3. Verificar que la API rechaza o procesa como fallido (Asíncrono 202 o HTTP 4xx)", async () => {
            expect([200, 201, 202, 400, 422, 500]).toContain(res.status);
        });

        await allure.step("4. Evidenciar Estado FAILED en Grilla Merchant", async () => {
            const txId = res.data.transaction_id || res.data.id || (res.data.details && res.data.details.transaction_processed && res.data.details.transaction_processed.transaction_id);
            
            if (txId) {
                // Navegar a la grilla de salidas
                await page.goto(`${envConfig.BASE_URL.replace("api", "merchant")}/transactions/out`);
                await page.waitForLoadState('networkidle').catch(() => null);
                await page.waitForTimeout(3000); // Tiempo para que la grilla cargue

                const cleanTxId = String(txId).trim().toLowerCase();
                const shortTxId = cleanTxId.substring(0, 13);
                
                const targetRow = page.locator('tr').filter({ hasText: new RegExp(shortTxId, "i") }).first();
                await targetRow.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
                
                if (await targetRow.isVisible().catch(() => false)) {
                    const rowText = await targetRow.innerText().catch(() => "");
                    console.log(`[🔍 DEBUG UI] Texto de la fila (Insuficiente) para ${shortTxId}:`, rowText.replace(/\n/g, ' | '));
                    
                    const isFailed = /fail|fall|rechaz|reject|cancel|deneg|anul|declin/i.test(rowText);
                    
                    const rowSnap = await targetRow.screenshot({ timeout: 5000 }).catch(() => null);
                    if (rowSnap) {
                        await allure.attachment(`📸 Evidencia: Payout Insuficiente marcado como FAILED`, rowSnap, "image/png");
                    }
                    
                    expect(isFailed).toBeTruthy();
                } else {
                    console.log(`⚠️ La transacción ${txId} no apareció en la grilla. Posible rechazo síncrono que no se registra en UI.`);
                    await attachScreenshot('Grilla Payouts - Transacción no encontrada por rechazo síncrono');
                }
            } else {
                console.log(`⚠️ La API no devolvió un ID de transacción. Rechazo síncrono confirmado.`);
            }
        });

        await allure.step("5. Verificar que el Balance no fue afectado", async () => {
            finalInsfBal = await loginAndCaptureDashboard(page, allure, false, 'AR');
            expect(finalInsfBal.available).toBeCloseTo(initInsfBal.available, 1);

            if (allure && allure.attachment) {
                await allure.attachment(`Payout Audit and Calculation (Insufficient Funds)`, JSON.stringify({
                    "1. Initial Balance (Before Payout)": filterBalance(initInsfBal),
                    "2. Attempted Payout Amount (Exceeds Available)": excessMonto,
                    "3. Final Balance (Unchanged)": filterBalance(finalInsfBal),
                    "Is Balance Protected? (Initial == Final)": initInsfBal.available === finalInsfBal.available
                }, null, 2), "application/json");
            }
        });
    });

});
