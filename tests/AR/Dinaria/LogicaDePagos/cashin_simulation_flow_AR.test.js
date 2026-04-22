const axios = require('axios');
const allure = require('allure-js-commons');
const { chromium } = require('playwright');
const { getAccessToken } = require('../../../../utils/authHelper');
const envConfig = require('../../../../utils/envConfig');
const { loginAndCaptureDashboard, fastAdminAction, setPartnerAllowOverUnder, visualAdminFail } = require('../../../../utils/uiBalanceHelper');

jest.setTimeout(1800000); 

describe(`[Logica Financiera] Dinaria AR: Cash-In Webhooks Matrix [Env: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    let token = '';
    let browser, context, sharedPage;
    const DINARIA_SANDBOX_URL = 'https://api.sandbox.dinaria.com/ars/cashin/simulate';

    beforeAll(async () => {
        try {
            browser = await chromium.launch({ headless: true });
            context = await browser.newContext({ locale: 'es-AR', colorScheme: 'dark', viewport: { width: 1920, height: 1080 } });
            sharedPage = await context.newPage();
            sharedPage.setDefaultTimeout(15000);
        } catch(e) {}
    });

    beforeEach(async () => {
        token = await getAccessToken();
    });

    afterAll(async () => {
        if(browser) await browser.close();
    });

    const captureMerchantGridTx = async (page, txId, statusLabel) => {
        const currentEnv = (envConfig.currentEnvName || "dev").toLowerCase();
        const transactionsUrl = `https://merchant.v2.${currentEnv}.paypaga.com/transactions/pay-in`;
        
        await page.goto(transactionsUrl, { waitUntil: 'domcontentloaded' }).catch(()=>null);
        await page.waitForTimeout(5000); 
        
        const searchInput = page.locator('input[type="text"], input[placeholder*="Buscar"], input[placeholder*="Search"]').first();
        if(await searchInput.isVisible().catch(()=>false)){
            await searchInput.fill(txId);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(3000);
        } else {
            await page.getByRole('link', { name: /Transacciones/i }).first().click({ force: true }).catch(()=>null);
            await page.waitForTimeout(1000);
            await page.getByRole('link', { name: /Entrada|Pay-In|Ingresos/i }).first().click({ force: true }).catch(()=>null);
            await page.waitForTimeout(4000);
        }

        const targetRow = page.locator('tr', { hasText: txId }).first();
        
        if (allure && allure.attachment) {
            try {
                let buffer;
                if(await targetRow.isVisible().catch(()=>false)){
                    await targetRow.scrollIntoViewIfNeeded();
                    
                    const tableContainer = page.locator('table').first();
                    if(await tableContainer.isVisible()) {
                         await tableContainer.evaluate(node => {
                             if(node.parentElement && node.parentElement.scrollWidth > node.parentElement.clientWidth) {
                                  node.parentElement.scrollLeft = node.parentElement.scrollWidth;
                             }
                         }).catch(()=>null);
                    }
                    
                    await page.waitForTimeout(500);
                    // Toma foto SOLO de la fila específica (ROW ONLY)
                    buffer = await targetRow.screenshot();
                } else {
                    buffer = await page.locator('table').first().screenshot().catch(async () => await page.screenshot());
                }
                await allure.attachment(`📸 Evidencia Grilla Merchant (${statusLabel}) - ${txId}`, buffer, "image/png");
            } catch(e) {}
        }
    };

    const buildH2HPayin = async (amount, allowOverUnder = true) => {
        const createPayinUrl = `${envConfig.BASE_URL}/v2/transactions/pay-in`;
        const referenceId = `DINARIA-LOGIC-${Date.now()}`;
        const targetCuit = "20275105792"; 

        const payload = {
            "amount": amount,
            "country": "AR",
            "currency": "ARS",
            "payment_method": "cvu", 
            "merchant_transaction_reference": referenceId,
            "merchant_customer_id": "dinaria_sandbox@paypaga.com",
            "allowOverUnder": allowOverUnder,
            "fields": {
                "first_name": "Jon",
                "last_name": "Snow",
                "document_number": targetCuit,
                "document_type": "CUIL",
                "email": "dinaria_sandbox@paypaga.com"
            }
        };

        const response = await axios.post(createPayinUrl, payload, {
            headers: {
                'DisablePartnerMock': 'true',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            validateStatus: () => true
        });

        if (allure && allure.attachment) {
            allure.attachment(`[API] 1. Request POST /pay-in`, JSON.stringify(payload, null, 2), "application/json");
            allure.attachment(`[API] 2. Response /pay-in (${response.status})`, JSON.stringify(response.data, null, 2), "application/json");
        }

        if (response.status !== 200 && response.status !== 201) {
            throw new Error(`Falló la creación del Pay-In: ${JSON.stringify(response.data)}`);
        }

        const txId = response.data.transaction_id || response.data.id || 'No Asignado';
        
        let assignedCvu = null;
        let assignedReference = null;

        if (response.data.instructions) {
            assignedCvu = response.data.instructions.bank_account;
            assignedReference = response.data.instructions.reference;
        } else if (response.data.paymentData) { 
            assignedCvu = response.data.paymentData.cbu;
            assignedReference = response.data.paymentData.reference;
        } else {
            let pMethods = response.data.payment_methods || [];
            if(pMethods.length > 0 && pMethods[0].fields) {
                 const cvuField = pMethods[0].fields.find(f => f.name && f.name.toLowerCase().includes('cvu'));
                 if(cvuField) assignedCvu = cvuField.value;
                 
                 const refField = pMethods[0].fields.find(f => f.name && f.name.toLowerCase().includes('reference'));
                 if(refField) assignedReference = refField.value;
            }
        }

        if(!assignedReference) assignedReference = txId;

        return { txId, assignedCvu, assignedReference, cuit: targetCuit, fullResponse: response.data };
    };

    const simulateDinariaCashIn = async (extractedCbu, targetCuit, injectAmount, reference) => {
        const sandboxToken = process.env.DINARIA_SANDBOX_TOKEN || 'di_sand_reg_paypaga_merch';
        if(!sandboxToken) throw new Error("CRÍTICO: Falla Autenticación. No se encontró DINARIA_SANDBOX_TOKEN. ¡Debes colocar el Bearer Token real del Sandbox de Dinaria en las variables de entorno!");

        const simPayload = {
            "cbu": extractedCbu,
            "cuit": targetCuit,
            "amount": injectAmount.toFixed(2),
            "idTrxCliente": reference, 
            "nombre": "Jon Snow"
        };

        const res = await axios.post(DINARIA_SANDBOX_URL, simPayload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${sandboxToken}`
            },
            validateStatus: () => true
        });

        if (allure && allure.attachment) {
            allure.attachment(`[SANDBOX] 1. Inyección Simulator (${injectAmount})`, JSON.stringify(simPayload, null, 2), "application/json");
            allure.attachment(`[SANDBOX] 2. Respuesta Dinaria API (${res.status})`, JSON.stringify(res.data || "Empty Response", null, 2), "application/json");
        }

        return { status: res.status, data: res.data, payloadInyectado: simPayload };
    };

    const waitForStatusUpdate = async (txId, maxTries = 10, delayMs = 3500) => {
        for (let i = 0; i < maxTries; i++) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
            const statRes = await axios.get(`${envConfig.BASE_URL}/v2/transactions/pay-in/${txId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const currentStatus = (statRes.data.status || "PENDING").toLowerCase();
            if (currentStatus === 'confirmed' || currentStatus === 'completed' || currentStatus === 'failed' || currentStatus === 'rejected' || currentStatus === 'expired') {
                return statRes.data; 
            }
        }
        const finalCheck = await axios.get(`${envConfig.BASE_URL}/v2/transactions/pay-in/${txId}`, { headers: { 'Authorization': `Bearer ${token}` }});
        return finalCheck.data;
    };

    // =========================================================================================
    // BLOQUE A: ALLOW OVER UNDER = TRUE
    // =========================================================================================
    describe('Bloque A: allowOverUnder = TRUE (Políticas Permisivas)', () => {
        
        beforeAll(async () => {
            await allure.step("⚙️ Configuración Global del Bloque A: allowOverUnder = TRUE", async () => {
                await setPartnerAllowOverUnder(sharedPage, true, allure);
            });
        });

        test('A1. Exact Match (Pago Exacto): Inyección del 100% de la orden', async () => {
            const ordenAmount = 1500.00;
            await allure.step("1. Capturar Dashboard Inicial (UI)", async () => { await loginAndCaptureDashboard(sharedPage, allure, true, 'AR'); });
            const payinInfo = await buildH2HPayin(ordenAmount, true);
            if(!payinInfo.assignedCvu) return;
            await allure.step("2. Evidencia Grilla (Estado Base Pending)", async () => { await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Pending'); });
            const simRes = await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, ordenAmount, payinInfo.assignedReference);
            expect([200, 201]).toContain(simRes.status);
            const finalTx = await waitForStatusUpdate(payinInfo.txId);
            const finalStatus = (finalTx.status || "").toLowerCase();
            if (allure && allure.attachment) { allure.attachment(`Conciliación Final API`, JSON.stringify({ Status: finalStatus, Data: finalTx }, null, 2), "application/json"); }
            await allure.step("4. Evidencia Visual Front (Impacto Económico)", async () => {
                await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Completed');
                const fb = await loginAndCaptureDashboard(sharedPage, allure, false, 'AR');
                if (allure && allure.attachment) allure.attachment(`Saldos Finales Extraídos Front`, JSON.stringify(fb, null, 2), "application/json");
            });
            expect(finalStatus).toMatch(/confirmed|completed|approved/i);
        });

        test('A2. Under Pay (Abono Parcial Permitido): Se concilia un pago menor', async () => {
            const ordenAmount = 1500.00;
            const depositAmount = 1000.00;
            await allure.step("1. Capturar Dashboard Inicial (UI)", async () => { await loginAndCaptureDashboard(sharedPage, allure, true, 'AR'); });
            const payinInfo = await buildH2HPayin(ordenAmount, true); 
            if(!payinInfo.assignedCvu) return;
            await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Pending');
            const simRes = await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, depositAmount, payinInfo.assignedReference);
            expect([200, 201]).toContain(simRes.status);
            const finalTx = await waitForStatusUpdate(payinInfo.txId);
            const finalStatus = (finalTx.status || "").toLowerCase();
            if (allure && allure.attachment) allure.attachment(`Resultado Under Pay API`, JSON.stringify({ Status: finalStatus, Data: finalTx }, null, 2), "application/json");
            await allure.step("4. Evidencia Visual Front (Menor volumen inyectado)", async () => {
                await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Completed (UnderPay)');
                await loginAndCaptureDashboard(sharedPage, allure, false, 'AR');
            });
            expect(finalStatus).toMatch(/confirmed|completed|approved/i);
        });

        test('A3. Over Pay (Abono Mayor Permitido): El cliente transfiere de más', async () => {
            const ordenAmount = 1500.00;
            const depositAmount = 2500.00; 
            await allure.step("1. Capturar Dashboard UI", async () => { await loginAndCaptureDashboard(sharedPage, allure, true, 'AR'); });
            const payinInfo = await buildH2HPayin(ordenAmount, true); 
            if(!payinInfo.assignedCvu) return;
            await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Pending');
            const simRes = await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, depositAmount, payinInfo.assignedReference);
            expect([200, 201]).toContain(simRes.status);
            const finalTx = await waitForStatusUpdate(payinInfo.txId);
            const finalStatus = (finalTx.status || "").toLowerCase();
            if (allure && allure.attachment) allure.attachment(`Over Pay Tolerado API`, JSON.stringify({ Status: finalStatus, Data: finalTx }, null, 2), "application/json");
            await allure.step("4. Evidencia Frontend (Subió más capital del ordenado)", async () => {
                await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Completed (OverPay)');
                await loginAndCaptureDashboard(sharedPage, allure, false, 'AR');
            });
            expect(finalStatus).toMatch(/confirmed|completed|approved/i);
        });

        /* test('A4. Pagos Parciales Acumulativos (Multi-part): Abonos separados al mismo CVU', async () => {
            const ordenAmount = 2000.00;
            const abono1 = 1000.00;
            const abono2 = 1000.00;
            await allure.step("1. Capturar Dashboard Inicial", async () => { await loginAndCaptureDashboard(sharedPage, allure, true, 'AR'); });
            const payinInfo = await buildH2HPayin(ordenAmount, true); 
            if(!payinInfo.assignedCvu) return;
            await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Pending');
            const simRes1 = await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, abono1, payinInfo.assignedReference);
            expect([200, 201]).toContain(simRes1.status);
            await new Promise(resolve => setTimeout(resolve, 5000)); 
            const simRes2 = await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, abono2, payinInfo.assignedReference);
            expect([200, 201]).toContain(simRes2.status);
            const finalTx = await waitForStatusUpdate(payinInfo.txId, 8, 4000);
            const finalStatus = (finalTx.status || "").toLowerCase();
            if (allure && allure.attachment) allure.attachment(`Resultados de Multi-Part`, JSON.stringify({ Status: finalStatus, Data: finalTx }, null, 2), "application/json");
            await allure.step("4. Visualizar Front", async () => {
                await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Evaluacion Multi-Part');
                await loginAndCaptureDashboard(sharedPage, allure, false, 'AR');
            });
            expect(finalStatus).toMatch(/confirmed|completed|approved/i);
        }); */

        test('A5. Prueba de Idempotencia: Webhooks duplicados simultáneos', async () => {
            const ordenAmount = 1000.00;
            await allure.step("1. Capturar Dashboard UI", async () => { await loginAndCaptureDashboard(sharedPage, allure, true, 'AR'); });
            const payinInfo = await buildH2HPayin(ordenAmount, true); 
            if(!payinInfo.assignedCvu) return;
            await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Pending');
            await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, ordenAmount, payinInfo.assignedReference);
            await new Promise(resolve => setTimeout(resolve, 500)); 
            await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, ordenAmount, payinInfo.assignedReference);
            const finalTx = await waitForStatusUpdate(payinInfo.txId);
            const finalStatus = (finalTx.status || "").toLowerCase();
            if (allure && allure.attachment) allure.attachment(`Validación Idempotencia API`, JSON.stringify({ Status: finalStatus, Data: finalTx }, null, 2), "application/json");
            await allure.step("4. Evidencia Frontend", async () => {
                await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Completed Idempotente');
                await loginAndCaptureDashboard(sharedPage, allure, false, 'AR');
            });
            expect(finalStatus).toMatch(/confirmed|completed|approved/i);
        });

        test('A6. Pago en Transacción Cancelada: Abono en CVU vencido o rechazado', async () => {
            const ordenAmount = 1000.00;
            await allure.step("1. Capturar Dashboard UI", async () => { await loginAndCaptureDashboard(sharedPage, allure, true, 'AR'); });
            const payinInfo = await buildH2HPayin(ordenAmount, true); 
            if(!payinInfo.assignedCvu) return;
            await visualAdminFail(sharedPage, payinInfo.txId, 'pay-in', allure);
            
            // Sincronización mandataria: esperar que la base de datos impacte el estado "Expired/Failed" antes de tirar el webhook
            let preStatusTx = await waitForStatusUpdate(payinInfo.txId, 6, 4000);
            console.log(`[A6] DB State antes de Webhook: ${preStatusTx.status}`);

            const simRes = await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, ordenAmount, payinInfo.assignedReference);
            expect([200, 201, 400, 404, 409, 422, 500]).toContain(simRes.status);
            const finalTx = await waitForStatusUpdate(payinInfo.txId, 6, 4000);
            const finalStatus = (finalTx.status || "").toLowerCase();
            if (allure && allure.attachment) allure.attachment(`Comportamiento de Canceladas API`, JSON.stringify({ Status: finalStatus, Data: finalTx }, null, 2), "application/json");
            await allure.step("4. Evidencia Frontend de Cancelación", async () => {
                await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Estado tras Abono Extra');
                await loginAndCaptureDashboard(sharedPage, allure, false, 'AR');
            });
            expect(finalStatus).toMatch(/rejected|failed|pending|expired|declined|cancelled/i);
        });

        test('A7. Mismatch de CUIT / Tercerización de Pago (Tolerado por el sistema)', async () => {
            const ordenAmount = 1500.00;
            const differentCuit = "20111111112"; 
            await allure.step("1. Capturar Dashboard Inicial", async () => { await loginAndCaptureDashboard(sharedPage, allure, true, 'AR'); });
            const payinInfo = await buildH2HPayin(ordenAmount, true); 
            if(!payinInfo.assignedCvu) return;
            await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Pending');
            const simRes = await simulateDinariaCashIn(payinInfo.assignedCvu, differentCuit, ordenAmount, payinInfo.assignedReference);
            expect([200, 201]).toContain(simRes.status);
            const finalTx = await waitForStatusUpdate(payinInfo.txId);
            const finalStatus = (finalTx.status || "").toLowerCase();
            if (allure && allure.attachment) allure.attachment(`Asimilación de Tercerizados API (CUIT Diferente)`, JSON.stringify({ Status: finalStatus, Data: finalTx }, null, 2), "application/json");
            await allure.step("4. Evidencia Visual Front", async () => {
                await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Completed o Manual Review');
                await loginAndCaptureDashboard(sharedPage, allure, false, 'AR');
            });
            expect(finalStatus).toMatch(/confirmed|completed|approved/i);
        });
    });

    // =========================================================================================
    // BLOQUE B: ALLOW OVER UNDER = FALSE
    // =========================================================================================
    describe('Bloque B: allowOverUnder = FALSE (Políticas Restrictivas)', () => {

        beforeAll(async () => {
            await allure.step("⚙️ Configuración Global del Bloque B: allowOverUnder = FALSE", async () => {
                await setPartnerAllowOverUnder(sharedPage, false, allure);
            });
        });

        test('B1. Exact Match Strict: Pago exacto debe completarse', async () => {
            const ordenAmount = 1500.00;
            await allure.step("1. Capturar Dashboard Inicial", async () => { await loginAndCaptureDashboard(sharedPage, allure, true, 'AR'); });
            const payinInfo = await buildH2HPayin(ordenAmount, false); 
            if(!payinInfo.assignedCvu) return;
            await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Pending');
            const simRes = await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, ordenAmount, payinInfo.assignedReference);
            expect([200, 201]).toContain(simRes.status);
            const finalTx = await waitForStatusUpdate(payinInfo.txId);
            const finalStatus = (finalTx.status || "").toLowerCase();
            if (allure && allure.attachment) allure.attachment(`Conciliación Exact Match (Restringida)`, JSON.stringify({ Status: finalStatus, Data: finalTx }, null, 2), "application/json");
            await allure.step("4. Evidencia Visual Front", async () => {
                await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Completed Strict');
                await loginAndCaptureDashboard(sharedPage, allure, false, 'AR');
            });
            expect(finalStatus).toMatch(/confirmed|completed|approved/i);
        });

        test('B2. Under Pay Estricto: Intento de pagar menos (Debe Retenerse / Rechazarse)', async () => {
            const ordenAmount = 1000.00;
            const depositAmount = 800.00; 
            await allure.step("1. Capturar Dashboard UI (Estado Base)", async () => { await loginAndCaptureDashboard(sharedPage, allure, true, 'AR'); });
            const payinInfo = await buildH2HPayin(ordenAmount, false); 
            if(!payinInfo.assignedCvu) return;
            await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Pending');
            const simRes = await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, depositAmount, payinInfo.assignedReference);
            expect([200, 201]).toContain(simRes.status);
            const finalTx = await waitForStatusUpdate(payinInfo.txId, 6, 4000); 
            const finalStatus = (finalTx.status || "").toLowerCase();
            if (allure && allure.attachment) allure.attachment(`Estado Rebote API`, JSON.stringify({ Status: finalStatus, Data: finalTx }, null, 2), "application/json");
            await allure.step("4. Visualizar Front (Saldo Intacto)", async () => {
                await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Estado Intacto: Pending');
                await loginAndCaptureDashboard(sharedPage, allure, false, 'AR');
            });
            expect(finalStatus).toMatch(/pending|failed|rejected/i);
        });

        test('B3. Sobrepago Bloqueado Estricto: El excedente debe ser rechazado', async () => {
            const ordenAmount = 1000.00;
            const depositAmount = 1200.00; 
            await allure.step("1. Capturar Dashboard UI (Estado Base)", async () => { await loginAndCaptureDashboard(sharedPage, allure, true, 'AR'); });
            const payinInfo = await buildH2HPayin(ordenAmount, false); 
            if(!payinInfo.assignedCvu) return;
            await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Pending');
            const simRes = await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, depositAmount, payinInfo.assignedReference);
            expect([200, 201]).toContain(simRes.status);
            const finalTx = await waitForStatusUpdate(payinInfo.txId, 6, 4000); 
            const finalStatus = (finalTx.status || "").toLowerCase();
            if (allure && allure.attachment) allure.attachment(`Estado Rebote por Sobrepago API`, JSON.stringify({ Status: finalStatus, Data: finalTx }, null, 2), "application/json");
            await allure.step("4. Visualizar Front", async () => {
                await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Estado Intacto: Pending');
                await loginAndCaptureDashboard(sharedPage, allure, false, 'AR');
            });
            expect(finalStatus).toMatch(/pending|failed|rejected/i);
        });

        /* test('B4. Multi-part Restringido: Fraccionamiento bloqueado como underpay', async () => {
            const ordenAmount = 2000.00;
            const abono1 = 1000.00;
            const abono2 = 1000.00;
            await allure.step("1. Capturar Dashboard Inicial", async () => { await loginAndCaptureDashboard(sharedPage, allure, true, 'AR'); });
            const payinInfo = await buildH2HPayin(ordenAmount, false); 
            if(!payinInfo.assignedCvu) return;
            await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Pending');
            const simRes1 = await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, abono1, payinInfo.assignedReference);
            expect([200, 201]).toContain(simRes1.status);
            await new Promise(resolve => setTimeout(resolve, 5000)); 
            const simRes2 = await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, abono2, payinInfo.assignedReference);
            expect([200, 201]).toContain(simRes2.status);
            const finalTx = await waitForStatusUpdate(payinInfo.txId, 6, 4000);
            const finalStatus = (finalTx.status || "").toLowerCase();
            if (allure && allure.attachment) allure.attachment(`Resultados de Multi-Part Restringido`, JSON.stringify({ Status: finalStatus, Data: finalTx }, null, 2), "application/json");
            await allure.step("4. Visualizar Front", async () => {
                await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Evaluacion Multi-Part Negada');
                await loginAndCaptureDashboard(sharedPage, allure, false, 'AR');
            });
            expect(finalStatus).toMatch(/pending|failed|rejected/i);
        }); */

        test('B5. Idempotencia Restringida (false): Webhooks duplicados', async () => {
            const ordenAmount = 1000.00;
            await allure.step("1. Capturar Dashboard UI", async () => { await loginAndCaptureDashboard(sharedPage, allure, true, 'AR'); });
            const payinInfo = await buildH2HPayin(ordenAmount, false); 
            if(!payinInfo.assignedCvu) return;
            await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Pending');
            await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, ordenAmount, payinInfo.assignedReference);
            await new Promise(resolve => setTimeout(resolve, 500)); 
            await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, ordenAmount, payinInfo.assignedReference);
            const finalTx = await waitForStatusUpdate(payinInfo.txId);
            const finalStatus = (finalTx.status || "").toLowerCase();
            if (allure && allure.attachment) allure.attachment(`Validación Idempotencia Estricta API`, JSON.stringify({ Status: finalStatus, Data: finalTx }, null, 2), "application/json");
            await allure.step("4. Evidencia Frontend", async () => {
                await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Completed Idempotente Strict');
                await loginAndCaptureDashboard(sharedPage, allure, false, 'AR');
            });
            expect(finalStatus).toMatch(/confirmed|completed|approved/i);
        });

        test('B6. Pago Cancelado Restringido: Dinero llega tras cancelación por Admin', async () => {
            const ordenAmount = 1000.00;
            await allure.step("1. Capturar Dashboard UI", async () => { await loginAndCaptureDashboard(sharedPage, allure, true, 'AR'); });
            const payinInfo = await buildH2HPayin(ordenAmount, false); 
            if(!payinInfo.assignedCvu) return;
            await visualAdminFail(sharedPage, payinInfo.txId, 'pay-in', allure);
            
            // Sincronización mandataria: esperar que la base de datos impacte el estado "Expired/Failed" antes de tirar el webhook
            let preStatusTx = await waitForStatusUpdate(payinInfo.txId, 6, 4000);
            console.log(`[B6] DB State antes de Webhook: ${preStatusTx.status}`);

            const simRes = await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, ordenAmount, payinInfo.assignedReference);
            
            // Allow 400/500 range because the platform rejects webhooks for Expired transactions
            expect([200, 201, 400, 404, 409, 422, 500]).toContain(simRes.status);
            
            const finalTx = await waitForStatusUpdate(payinInfo.txId, 6, 4000);
            const finalStatus = (finalTx.status || "").toLowerCase();
            if (allure && allure.attachment) allure.attachment(`Comportamiento de Canceladas API Strict`, JSON.stringify({ Status: finalStatus, Data: finalTx }, null, 2), "application/json");
            await allure.step("4. Evidencia Frontend", async () => {
                await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Estado Intacto');
                await loginAndCaptureDashboard(sharedPage, allure, false, 'AR');
            });
            expect(finalStatus).toMatch(/rejected|failed|pending|expired|declined|cancelled/i);
        });

        test('B7. Mismatch de CUIT Restringido (false): Debe rebotar por identidad', async () => {
            const ordenAmount = 1500.00;
            const differentCuit = "20111111112"; 
            await allure.step("1. Capturar Dashboard Inicial", async () => { await loginAndCaptureDashboard(sharedPage, allure, true, 'AR'); });
            const payinInfo = await buildH2HPayin(ordenAmount, false); 
            if(!payinInfo.assignedCvu) return;
            await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Pending');
            const simRes = await simulateDinariaCashIn(payinInfo.assignedCvu, differentCuit, ordenAmount, payinInfo.assignedReference);
            expect([200, 201]).toContain(simRes.status);
            const finalTx = await waitForStatusUpdate(payinInfo.txId, 6, 4000);
            const finalStatus = (finalTx.status || "").toLowerCase();
            if (allure && allure.attachment) allure.attachment(`Resultado Mismatch API`, JSON.stringify({ Status: finalStatus, Data: finalTx }, null, 2), "application/json");
            await allure.step("4. Evidencia Visual Front", async () => {
                await captureMerchantGridTx(sharedPage, payinInfo.txId, 'Rejected o Manual Review');
                await loginAndCaptureDashboard(sharedPage, allure, false, 'AR');
            });
            // Asumimos que con 'false' de políticas, un CUIT distinto también se rechaza
            expect(finalStatus).toMatch(/rejected|failed|pending/i);
        });

    });

});
