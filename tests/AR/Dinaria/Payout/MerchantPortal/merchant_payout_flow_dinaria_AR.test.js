const { getAccessToken } = require('../../../../../utils/authHelper');
const { chromium } = require('playwright');
const allure = require('allure-js-commons');
const envConfig = require('../../../../../utils/envConfig');
const { loginAndCaptureDashboard, fastAdminAction, preLoadFunds } = require('../../../../../utils/uiBalanceHelper');

jest.setTimeout(1800000); 

describe(`[E2E Híbrido] FULL FLOW - MERCHANT PORTAL AR Payout: Creación, Grilla y Admin Approve [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
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
        const merchantUrl = envConfig.BASE_URL.replace("api", "merchant");
        await page.goto(`${merchantUrl}/transactions/pay-out`).catch(()=>null);
        await page.waitForLoadState('networkidle').catch(()=>null);
        await page.waitForTimeout(3000);
        
        const btnCrear = page.getByRole('link', { name: /Crear|Create/i }).first();
        await btnCrear.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
        await btnCrear.click({ force: true });

        await page.waitForTimeout(3000);
        
        // 1. País: Argentina
        await page.locator('#country').selectOption('AR');
        await page.waitForTimeout(1000); // Dar tiempo a que reaccione el frontend

        // 2. Método de Pago: Validar que sea CVU (Transferencias Instantáneas)
        await page.locator('#payment_method').selectOption('cvu').catch(()=>null);
        await page.waitForTimeout(500);

        // 3. Monto
        await page.locator('#amount').fill(monto.toString());
        await page.locator('#amount').press('Tab');

        // 4. Datos del Beneficiario
        await page.locator('#first_name').fill('Sergio');
        await page.locator('#last_name').fill('Test');
        await page.locator('#document_number').fill('20275105792'); 
        
        // 5. Datos Bancarios
        await page.locator('#account_number').fill('0070327530004025541644'); 
        await page.locator('#account_number').press('Tab');
        
        // 6. Opciones de Mock
        const disableMockCheck = page.locator('#disable_mock');
        if (await disableMockCheck.isVisible().catch(()=>false)) {
            const isChecked = await disableMockCheck.isChecked();
            if (!isChecked) await disableMockCheck.click({ force: true });
        }
        
        await attachScreenshot(`Formulario Payout - ${refTag}`);
        
        // 7. Crear Pago
        const saveBtn = page.locator('#save');
        await saveBtn.scrollIntoViewIfNeeded().catch(() => null);
        await saveBtn.click({ force: true });
        
        await page.waitForTimeout(2000);
        
        // Verificamos si seguimos en el formulario (si el botón Guardar sigue ahí y es visible)
        if (await saveBtn.isVisible().catch(() => false)) {
             console.log("❌ ERROR: El botón Guardar sigue visible. El formulario NO se envió. Revisando campos inválidos...");
             
             // Revisar validaciones nativas HTML5
             const isInvalid = await page.evaluate(() => {
                 const invalidElements = document.querySelectorAll(':invalid');
                 return invalidElements.length > 0 ? Array.from(invalidElements).map(el => el.id || el.name || el.tagName).join(', ') : null;
             });
             
             if (isInvalid) console.log("⚠️ CAMPOS HTML5 INVÁLIDOS DETECTADOS:", isInvalid);
             
             await attachScreenshot(`Error Formulario No Enviado - ${refTag}`);
             return null; // Forzamos un null para que falle la creación de inmediato y no tome UUIDs viejos
        }

        // Loop de espera activa para atrapar el UUID (en caso de que salga en un modal, toast, o redirija a la grilla)
        let obtainedTxId = null;
        for (let i = 0; i < 8; i++) {
            await page.waitForTimeout(1000);
            obtainedTxId = await page.evaluate(() => {
                const match = document.body.innerText.match(/[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/);
                return match ? match[0] : null;
            });
            if (obtainedTxId) break;
        }

        if (!obtainedTxId) {
            console.log("⚠️ No se encontró el UUID tras guardar. Navegando explícitamente a la grilla para extraerlo...");
            const merchantUrl = envConfig.BASE_URL.replace("api", "merchant");
            await page.goto(`${merchantUrl}/transactions/pay-out`).catch(()=>null);
            await page.waitForLoadState('networkidle').catch(() => null);
            await page.waitForTimeout(4000);
            
            obtainedTxId = await page.evaluate(() => {
                const firstRowIdCell = document.querySelector('td[data-column="transactionId"]');
                if (firstRowIdCell) {
                    const text = firstRowIdCell.innerText || firstRowIdCell.textContent;
                    const match = text.match(/[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/);
                    return match ? match[0] : null;
                }
                return null;
            });
        }

        if (!obtainedTxId) {
            console.log("❌ ERROR CRÍTICO: No se pudo obtener el UUID del Payout creado.");
            await attachScreenshot(`Error UUID no encontrado - ${refTag}`);
        }

        return obtainedTxId;
    };

    const markStatusFromMerchantGrid = async (txId, statusToClick) => {
        try {
            const merchantUrl = envConfig.BASE_URL.replace("api", "merchant");
            await page.goto(`${merchantUrl}/dashboard`);
            await page.waitForTimeout(1000);
            await page.goto(`${merchantUrl}/transactions/pay-out`);
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
            const dataActionStr = statusToClick === 'approved' ? 'approve' : (statusToClick === 'expired' ? 'expired' : 'failed');
            console.log(`[🕹️ UI Action] Seleccionando ${dataActionStr}...`);
            
            // Intento A: JS Nativo
            await page.evaluate(({ action }) => {
                const opt = document.querySelector(`a[data-action="${action}"]`);
                if (opt) opt.click();
            }, { action: dataActionStr }).catch(() => null);

            // Intento B: Playwright force
            const regexStr = statusToClick === 'approved' ? /approv|aprob/i : (statusToClick === 'expired' ? /expired|expirar|expirado/i : /fail|fall|rechaz/i);
            await page.getByText(regexStr).first().click({ force: true, timeout: 2000 }).catch(() => null);

            // 4. Modal Confirmación
            await page.waitForTimeout(2000);
            const confirmBtn = page.getByRole('button', { name: /confirmar|confirm|yes|sí|si|aceptar|accept/i }).first();
            if (await confirmBtn.isVisible().catch(() => false)) {
                await confirmBtn.click({ force: true }).catch(() => null);
            }
            
            await page.waitForTimeout(10000); // 10s para backend
            await attachScreenshot(`Transacción Mercante Cambiada a ${statusToClick.toUpperCase()}`);
            
        } catch (e) {
            console.log(`🛡️ [UI Shield] Error neutralizado durante interacción de grilla: ${e.message}`);
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
                
                const rowFound = await page.evaluateHandle(({ fullId, shortId }) => {
                    const rows = Array.from(document.querySelectorAll('tr'));
                    const targetRow = rows.find(r => r.innerHTML.toLowerCase().includes(fullId) || r.innerText.toLowerCase().includes(shortId));
                    if (targetRow) {
                        // Remarcado elegante (azul claro transparente con borde izquierdo)
                        targetRow.style.backgroundColor = 'rgba(59, 130, 246, 0.15)';
                        targetRow.style.borderLeft = '4px solid #3b82f6';
                        targetRow.scrollIntoView({ behavior: 'instant', inline: 'center', block: 'center' });
                    }
                    return targetRow || null;
                }, { fullId: cleanTxId, shortId: shortTxId });
                
                if (rowFound && await rowFound.evaluate(n => n !== null)) {
                    await page.waitForTimeout(1000); // Esperar renderizado del nuevo viewport
                    
                    const box = await rowFound.boundingBox();
                    if (box) {
                        const snap = await page.screenshot({
                            clip: {
                                x: 0,
                                y: Math.max(0, box.y - 80), // 80px arriba para ver el renglón anterior o encabezado
                                width: 2560, // Todo el ancho de la pantalla
                                height: box.height + 120 // 120px abajo para ver el renglón siguiente
                            },
                            timeout: 5000
                        }).catch(() => null);
                        
                        if (snap) {
                            await allure.attachment(`📸 Evidencia Grilla: Payout - ${label}`, snap, "image/png");
                        }
                    }
                } else {
                    console.log(`⚠️ No se encontró la fila en la grilla para capturar evidencia: ${label}`);
                }

                // Restaurar tamaño para no romper otros elementos del test
                if (originalSize) {
                    await page.setViewportSize(originalSize).catch(() => null);
                }
            }
        } catch (e) { console.log("Skipping evidence capture due to error", e.message); }
    };

    test('1. Flujo Ómnicanal Happy Path: UI Saldos -> UI Payout Merchant -> Visto en M-Portal -> Admin Approve', async () => {
        // ==========================================
        // 1. OBTENER SALDO DEL DASHBOARD UI (Sincronización Híbrida)
        // ==========================================
        initialBalances = await loginAndCaptureDashboard(page, allure, true, 'AR');
        console.log("💰 SALDOS INICIALES (UI Merchant):", initialBalances);

        if (initialBalances.available < payoutMontoTest) {
            console.warn(`⚠️ ALERTA: Tienes ${initialBalances.available} disponibles. Probablemente falle la UI por falta de fondos.`);
        }
        
        // B) EJECUTAR PAYOUT DESDE MERCHANT UI
        storedTxId = await originarPayoutDesdeMerchant(payoutMontoTest, 'APPROVE');
        expect(storedTxId).not.toBeNull();

        // Damos tiempo al procesador backend para asentar el Payout y congelar el saldo
        await page.waitForTimeout(5000);

        // C) BALANCE INTERMEDIO: Verificar congelamiento de fondos (PENDING)
        const pendingBalances = await loginAndCaptureDashboard(page, allure, false, 'AR');
        expect(pendingBalances.available).toBeLessThan(initialBalances.available);
        console.log("🧊 SALDOS CONGELADOS EN PRE-APROBACIÓN (Merchant):", pendingBalances);

        // D) INSPECCIONAR GRILLA VISUALMENTE COMO EVIDENCIA (PENDING)
        const merchantUrl = envConfig.BASE_URL.replace("api", "merchant");
        await page.goto(`${merchantUrl}/transactions/pay-out`).catch(()=>null);
        await page.waitForLoadState('networkidle').catch(()=>null);
        await page.waitForTimeout(4000);

        await captureRowEvidence(storedTxId, 'PENDING');

        // ==========================================
        // 5. MARCAR COMO APROBADO DESDE ADMIN PORTAL
        // En este flujo, el Happy Path se aprueba desde el Admin Portal, 
        // tal como en el H2H.
        // ==========================================
        let baseURL = envConfig.BASE_URL;
        await page.goto(`${baseURL.replace("api", "merchant")}/logout`).catch(()=>null);
        await fastAdminAction(page, storedTxId, 'pay-out', allure, 'approve');
        await attachScreenshot('Transacción Confirmada Payout (Happy)');

        // ==========================================
        // 6. REGRESAR AL DASHBOARD Y VALIDAR IMPACTO
        // ==========================================
        // IMPORTANTE: Como fuimos al Admin Portal, perdimos la sesión del Merchant.
        // Debemos pasar 'true' para re-loguearnos, de lo contrario le tomaremos foto al Login.
        const finalBalances = await loginAndCaptureDashboard(page, allure, true, 'AR');
        console.log("💰 SALDOS FINALES TRAS APROBACIÓN MERCHANT:", finalBalances);

        // ==========================================
        // 7. CAPTURAR EVIDENCIA DE LA GRILLA (APPROVED)
        // ==========================================
        await page.goto(`${merchantUrl}/transactions/pay-out`).catch(()=>null);
        await page.waitForLoadState('networkidle').catch(()=>null);
        await page.waitForTimeout(4000);
        await captureRowEvidence(storedTxId, 'APPROVED');

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
                "Payout Amount Processed": payoutMontoTest
            }, null, 2), "application/json");
        }
    });

    test('2. Flujo Reverso Merchant por FAILED: Creación UI -> PENDING -> Dropdown Merchant (Failed) -> Reembolso', async () => {
        let revertMonto = 1200;
        let initRevertBal, myTx, pendingBal, finalRevertBal;

        await allure.step("1. Obtener Saldo Inicial desde UI", async () => {
            initRevertBal = await loginAndCaptureDashboard(page, allure, false, 'AR');
        });

        await allure.step("2. Emitir Payout UI", async () => {
            myTx = await originarPayoutDesdeMerchant(revertMonto, 'REVERSO_FAILED');
            expect(myTx).not.toBeNull();
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
    });

    test('3. Flujo Negativo UI: Fondos Insuficientes -> Payout UI (Monto Mayor al Disponible) -> Debe Fallar', async () => {
        let initInsfBal, excessMonto;

        await allure.step("1. Obtener Saldo Disponible Inicial", async () => {
            initInsfBal = await loginAndCaptureDashboard(page, allure, true, 'AR');
            excessMonto = initInsfBal.available + 15000.50; 
        });
        
        await allure.step("2. Emitir Payout UI con Fondos Insuficientes", async () => {
            // Intentamos crear un payout en UI con más plata de la que hay
            const merchantUrl = envConfig.BASE_URL.replace("api", "merchant");
            await page.goto(`${merchantUrl}/transactions/pay-out`).catch(()=>null);
            await page.waitForLoadState('networkidle').catch(()=>null);
            await page.waitForTimeout(3000);
            
            const btnCrear = page.getByRole('link', { name: /Crear|Create/i }).first();
            await btnCrear.waitFor({ state: 'visible', timeout: 5000 }).catch(()=>null);
            await btnCrear.click({ force: true });

            await page.waitForTimeout(3000);
            
            await page.locator('#country').selectOption('AR');
            await page.waitForTimeout(1000); 

            await page.locator('#payment_method').selectOption('cvu').catch(()=>null);

            // AQUI INGRESAMOS EL EXCESO
            await page.locator('#amount').fill(excessMonto.toString());
            await page.locator('#amount').press('Tab');
            
            await page.locator('#first_name').fill('Sergio');
            await page.locator('#last_name').fill('Test');
            await page.locator('#document_number').fill('20275105792'); 
            await page.locator('#account_number').fill('0070327530004025541644'); 
            await page.locator('#account_number').press('Tab');
            
            const disableMockCheck = page.locator('#disable_mock');
            if (await disableMockCheck.isVisible().catch(()=>false)) {
                const isChecked = await disableMockCheck.isChecked();
                if (!isChecked) await disableMockCheck.click({ force: true });
            }
            
            await attachScreenshot(`Formulario Payout - FONDOS INSUFICIENTES (Previo a Guardar)`);
            
            const saveBtn = page.locator('#save');
            await saveBtn.scrollIntoViewIfNeeded().catch(() => null);
            await saveBtn.click({ force: true });
            
            await page.waitForTimeout(3000); 
            
            // Verificamos que el UI muestre un error o no deje avanzar (siendo fondos insuficientes)
            const bodyText = await page.innerText('body').catch(() => "");
            const hasError = /fondos insuficientes|insufficient funds|error/i.test(bodyText);
            
            if (await saveBtn.isVisible().catch(()=>false)) {
                await attachScreenshot(`Resultado Payout UI Insuficiente (Bloqueo en Form)`);
            } else {
                // Redirigió a la grilla inesperadamente. Vamos a capturar la primera fila (la recién creada).
                const originalSize = page.viewportSize();
                await page.setViewportSize({ width: 2560, height: 1080 }).catch(() => null);
                
                const rowFound = await page.evaluateHandle(() => {
                    const firstRow = document.querySelector('tbody tr');
                    if (firstRow) {
                        // Resaltamos en rojo para denotar que es una transacción errónea
                        firstRow.style.backgroundColor = 'rgba(239, 68, 68, 0.15)'; 
                        firstRow.style.borderLeft = '4px solid #ef4444';
                        firstRow.scrollIntoView({ behavior: 'instant', inline: 'center', block: 'center' });
                    }
                    return firstRow || null;
                });
                
                if (rowFound && await rowFound.evaluate(n => n !== null)) {
                    await page.waitForTimeout(1000);
                    const box = await rowFound.boundingBox();
                    if (box) {
                        const snap = await page.screenshot({
                            clip: { x: 0, y: Math.max(0, box.y - 80), width: 2560, height: box.height + 120 },
                            timeout: 5000
                        }).catch(() => null);
                        if (snap) await allure.attachment(`📸 Evidencia Grilla: Payout Insuficiente (Fallo de Bloqueo)`, snap, "image/png");
                    }
                } else {
                    await attachScreenshot(`Resultado Payout UI Insuficiente (Redirección Inesperada)`);
                }
                
                if (originalSize) await page.setViewportSize(originalSize).catch(() => null);
            }

            if (hasError) {
                console.log("✅ El portal UI bloqueó exitosamente el intento de retiro con fondos insuficientes.");
            } else {
                console.log("⚠️ El portal UI permitió enviar el form, revisando estado en grilla...");
            }

            // C) Verificar balance final (debe ser igual al inicial porque falló instantáneamente o fue bloqueado)
            const finalInsfBal = await loginAndCaptureDashboard(page, allure, false, 'AR');
            expect(finalInsfBal.available).toBeCloseTo(initInsfBal.available, 1);
        });
    });

});
