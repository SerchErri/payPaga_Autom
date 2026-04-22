const axios = require('axios');
const allure = require('allure-js-commons');
const { chromium } = require('playwright');
const { getAccessToken } = require('../../../../utils/authHelper');
const envConfig = require('../../../../utils/envConfig');
const { loginAndCaptureDashboard, setPartnerAllowOverUnder } = require('../../../../utils/uiBalanceHelper');

jest.setTimeout(1800000); 

describe(`[Logica Financiera] Dinaria AR: Batch LIFO Payouts [Env: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    let token = '';
    let browser, context, sharedPage;
    const DINARIA_SANDBOX_URL = 'https://api.sandbox.dinaria.com/ars/cashin/simulate';

    beforeAll(async () => {
        try {
            browser = await chromium.launch({ headless: true });
            // Resolución grande para foto panorámica en LIFO
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
                    
                    // Highlight dinámico LIFO
                    await targetRow.evaluate(node => {
                        node.style.border = '3px solid #ef4444'; 
                        node.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
                    }).catch(()=>null);
                    
                    // Asegurar scroll horizontal a la derecha
                    const tableContainer = page.locator('table').first();
                    if(await tableContainer.isVisible()) {
                         await tableContainer.evaluate(node => {
                             if(node.parentElement && node.parentElement.scrollWidth > node.parentElement.clientWidth) {
                                  node.parentElement.scrollLeft = node.parentElement.scrollWidth;
                             }
                         }).catch(()=>null);
                    }
                    
                    await page.waitForTimeout(500);
                    buffer = await page.screenshot({ fullPage: true });

                    await targetRow.evaluate(node => {
                        node.style.border = '';
                        node.style.backgroundColor = '';
                    }).catch(()=>null);
                } else {
                    buffer = await page.screenshot({ fullPage: true });
                }
                await allure.attachment(`📸 Evidencia LIFO (${statusLabel}) - ${txId}`, buffer, "image/png");
            } catch(e) {}
        }
    };

    /**
     * Construye un PayIn estrictamente asociado al mismo cliente para prueba LIFO
     */
    const buildH2HLifoPayin = async (amount, index) => {
        const createPayinUrl = `${envConfig.BASE_URL}/v2/transactions/pay-in`;
        const referenceId = `LIFO-${Date.now()}-${index}`;
        const targetCuit = "20275105792"; 
        const targetEmail = "cliente_recurrente_lifo@paypaga.com";

        const payload = {
            "amount": amount,
            "country": "AR",
            "currency": "ARS",
            "payment_method": "cvu", 
            "merchant_transaction_reference": referenceId,
            "merchant_customer_id": targetEmail,
            "allowOverUnder": true,
            "fields": {
                "first_name": "Cliente",
                "last_name": "LIFO",
                "document_number": targetCuit,
                "document_type": "CUIL",
                "email": targetEmail
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

        return { txId, assignedCvu, assignedReference, cuit: targetCuit, fullResponse: response.data, amount };
    };

    const simulateDinariaCashIn = async (extractedCbu, targetCuit, injectAmount, reference) => {
        const sandboxToken = process.env.DINARIA_SANDBOX_TOKEN || 'di_sand_reg_paypaga_merch';
        const simPayload = {
            "cbu": extractedCbu,
            "cuit": targetCuit,
            "amount": injectAmount.toFixed(2),
            "nombre": "Jon Snow"
        };

        const res = await axios.post(DINARIA_SANDBOX_URL, simPayload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${sandboxToken}`
            },
            validateStatus: () => true
        });
        return { status: res.status, data: res.data };
    };

    const waitForStatusUpdate = async (txId, maxTries = 10, delayMs = 3500) => {
        for (let i = 0; i < maxTries; i++) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
            const statRes = await axios.get(`${envConfig.BASE_URL}/v2/transactions/pay-in/${txId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const currentStatus = (statRes.data.status || "PENDING").toLowerCase();
            if (currentStatus === 'confirmed' || currentStatus === 'completed' || currentStatus === 'failed') {
                return statRes.data; 
            }
        }
        const finalCheck = await axios.get(`${envConfig.BASE_URL}/v2/transactions/pay-in/${txId}`, { headers: { 'Authorization': `Bearer ${token}` }});
        return finalCheck.data;
    };


    test('Validación de Lógica LIFO (Last-In, First-Out) - Escenario del Desarrollador', async () => {
        
        await allure.step("1. Iniciar Sesión UI y Habilitar allowOverUnder", async () => {
            await loginAndCaptureDashboard(sharedPage, allure, true, 'AR');
            await setPartnerAllowOverUnder(sharedPage, true, allure);
        });

        // Developer Scenario: 
        // 1. Create Tx 1 for 1500 ARS
        // 2. Create Tx 2 for 1000 ARS
        // 3. Send Webhook for 1200 ARS (Without exact amount match, forces LIFO)
        // 4. Tx 2 (most recent) becomes approved. Tx 1 remains pending.

        let tx1, tx2;
        await allure.step("2. Generar Transacción 1 (1500 ARS)", async () => {
            tx1 = await buildH2HLifoPayin(1500.00, 1);
            await captureMerchantGridTx(sharedPage, tx1.txId, 'Generación Tx 1 - 1500 ARS');
        });

        await allure.step("3. Generar Transacción 2 (1000 ARS)", async () => {
            tx2 = await buildH2HLifoPayin(1000.00, 2);
            await captureMerchantGridTx(sharedPage, tx2.txId, 'Generación Tx 2 - 1000 ARS');
        });

        if (allure && allure.attachment) {
             allure.attachment("API: Transacciones LIFO Creadas", JSON.stringify([tx1, tx2], null, 2), "application/json");
        }

        await allure.step(`4. Inyectar Webhook desfasado en monto (1200 ARS) forzando LIFO`, async () => {
            // MandamosWebhook ciego para 1200 ARS (sin ID de la transacción para evitar emparejamiento manual)
            const simRes = await simulateDinariaCashIn(tx2.assignedCvu, tx2.cuit, 1200.00, tx2.assignedReference);
            expect([200, 201]).toContain(simRes.status);
            
            // Esperar que la transacción 2 (LA MÁS RECIENTE = LIFO) sea la que tome el pago
            const finalDataTx2 = await waitForStatusUpdate(tx2.txId, 8, 4000);
            const statusTx2 = (finalDataTx2.status || "").toLowerCase();
            
            await captureMerchantGridTx(sharedPage, tx2.txId, 'Conciliación LIFO -> Aprobó la última (Tx 2)');
            
            if (allure && allure.attachment) {
                allure.attachment(`Resultado API - Tx 2 (Última)`, JSON.stringify({ Status: statusTx2, Data: finalDataTx2 }, null, 2), "application/json");
            }
            
            // Verificamos que se haya aprobado a pesar de que sobraron 200 ARS
            expect(statusTx2).toMatch(/confirmed|completed|approved/i);
            
            // Validar que la Transacción 1 (LA MÁS VIEJA) siga pendiente, ya que todo el pago se lo comió la Tx 2 por LIFO
            const finalDataTx1 = await waitForStatusUpdate(tx1.txId, 2, 2000);
            const statusTx1 = (finalDataTx1.status || "").toLowerCase();
            await captureMerchantGridTx(sharedPage, tx1.txId, 'Supervivencia Tx 1 -> Mantiene Pending');
            expect(statusTx1).toMatch(/pending|initiated/i);
        });
        
    });

});
