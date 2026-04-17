const axios = require('axios');
const allure = require('allure-js-commons');
const { chromium } = require('playwright');
const { getAccessToken } = require('../../../../utils/authHelper');
const envConfig = require('../../../../utils/envConfig');
const { loginAndCaptureDashboard } = require('../../../../utils/uiBalanceHelper');

jest.setTimeout(1800000); 

describe(`[Logica Financiera] Dinaria AR: Cash-In Webhooks Under/Over Pay Simulator [Env: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    let token = '';
    let browser, context, sharedPage;
    const DINARIA_SANDBOX_URL = 'https://api.sandbox.dinaria.com/ars/cashin/simulate';

    beforeAll(async () => {
        token = await getAccessToken();
        try {
            browser = await chromium.launch({ headless: true });
            context = await browser.newContext({ locale: 'es-AR', colorScheme: 'dark' });
            sharedPage = await context.newPage();
            sharedPage.setDefaultTimeout(15000);
        } catch(e) {}
    });

    afterAll(async () => {
        if(browser) await browser.close();
    });

    /**
     * Helper H2H Interno: Crea un PayIn y extrae su CVU / CBU y CUIT
     */
    const buildH2HPayin = async (amount, allowOverUnder = true) => {
        const createPayinUrl = `${envConfig.BASE_URL}/v2/transactions/pay-in`;
        const referenceId = `DINARIA-LOGIC-${Date.now()}`;
        const targetCuit = "20275105792"; // CUIT Base

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
        let pMethods = response.data.payment_methods || [];
        if(pMethods.length > 0 && pMethods[0].fields) {
             const cvuField = pMethods[0].fields.find(f => f.name && f.name.toLowerCase().includes('cvu'));
             if(cvuField) assignedCvu = cvuField.value;
        }

        return { txId, assignedCvu, cuit: targetCuit, fullResponse: response.data };
    };

    /**
     * Helper Sandbox: Se hace pasar por el banco del cliente disparando al Endpoint Oficial de Dinaria
     */
    const simulateDinariaCashIn = async (extractedCbu, targetCuit, injectAmount) => {
        const sandboxToken = process.env.DINARIA_SANDBOX_TOKEN;
        if(!sandboxToken) throw new Error("CRÍTICO: Falla Autenticación. No se encontró DINARIA_SANDBOX_TOKEN. ¡Debes colocar el Bearer Token real del Sandbox de Dinaria en las variables de entorno!");

        const simPayload = {
            "cbu": extractedCbu,
            "cuit": targetCuit,
            "amount": injectAmount.toFixed(2),
            "idTrxCliente": `${Date.now()}${(Math.random() * 1000).toFixed(0)}`, // Generador randomico
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

    /**
     * Pooling GET: Escrutinio que espera pacientemente a que PayPaga absorba el Webhook simulado
     */
    const waitForStatusUpdate = async (txId, maxTries = 10, delayMs = 3500) => {
        for (let i = 0; i < maxTries; i++) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
            const statRes = await axios.get(`${envConfig.BASE_URL}/v2/transactions/${txId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const currentStatus = (statRes.data.status || "PENDING").toLowerCase();
            if (currentStatus === 'confirmed' || currentStatus === 'completed' || currentStatus === 'failed') {
                return statRes.data; // Rompió la vigilia
            }
        }
        // Si nunca cambió, retorna el estado actual
        const finalCheck = await axios.get(`${envConfig.BASE_URL}/v2/transactions/${txId}`, { headers: { 'Authorization': `Bearer ${token}` }});
        return finalCheck.data;
    };

    // =========================================================================================
    // CASOS GHERKIN (LOGICA FINANCIERA)
    // =========================================================================================

    test('1. Exact Match (Pago Exacto): Inyección del 100% de la orden', async () => {
        const ordenAmount = 1500.00;
        
        await allure.step("1. Capturar Dashboard Inicial (UI)", async () => {
            await loginAndCaptureDashboard(sharedPage, allure, true, 'AR');
        });

        const payinInfo = await buildH2HPayin(ordenAmount, true);
        if(!payinInfo.assignedCvu) return;
        
        const simRes = await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, ordenAmount);
        expect([200, 201]).toContain(simRes.status);

        const finalTx = await waitForStatusUpdate(payinInfo.txId);
        const finalStatus = (finalTx.status || "").toLowerCase();
        
        if (allure && allure.attachment) {
            allure.attachment(`Conciliación Final API`, JSON.stringify({ Status: finalStatus, Data: finalTx }, null, 2), "application/json");
        }
        
        await allure.step("4. Evidencia Visual Front (Impacto Económico)", async () => {
            const fb = await loginAndCaptureDashboard(sharedPage, allure, false, 'AR');
            if (allure && allure.attachment) allure.attachment(`Saldos Finales Extraídos Front`, JSON.stringify(fb, null, 2), "application/json");
        });

        expect(finalStatus).toMatch(/confirmed|completed/i);
    });

    test('2. Under Pay (Abono Parcial Permitido): Se concilia un pago menor', async () => {
        const ordenAmount = 1500.00;
        const depositAmount = 1000.00;
        
        await allure.step("1. Capturar Dashboard Inicial (UI)", async () => {
            await loginAndCaptureDashboard(sharedPage, allure, true, 'AR');
        });

        const payinInfo = await buildH2HPayin(ordenAmount, true); // true es la clave
        if(!payinInfo.assignedCvu) return;
        
        const simRes = await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, depositAmount);
        expect([200, 201]).toContain(simRes.status);

        const finalTx = await waitForStatusUpdate(payinInfo.txId);
        const finalStatus = (finalTx.status || "").toLowerCase();
        
        if (allure && allure.attachment) allure.attachment(`Resultado Under Pay API`, JSON.stringify({ Status: finalStatus, Data: finalTx }, null, 2), "application/json");

        await allure.step("4. Evidencia Visual Front (Menor volumen inyectado)", async () => {
            await loginAndCaptureDashboard(sharedPage, allure, false, 'AR');
        });

        expect(finalStatus).toMatch(/confirmed|completed/i);
    });

    test('3. RECHAZO ESTRICTO (No coincidencia Exacta con OverUnder denegado)', async () => {
        const ordenAmount = 1000.00;
        const depositAmount = 800.00; // Intento de pagar menos
        
        await allure.step("1. Capturar Dashboard UI (Estado Base)", async () => {
            await loginAndCaptureDashboard(sharedPage, allure, true, 'AR');
        });

        const payinInfo = await buildH2HPayin(ordenAmount, false); // FALSE
        if(!payinInfo.assignedCvu) return;
        
        const simRes = await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, depositAmount);
        expect([200, 201]).toContain(simRes.status);

        const finalTx = await waitForStatusUpdate(payinInfo.txId, 6, 4000); 
        const finalStatus = (finalTx.status || "").toLowerCase();
        
        if (allure && allure.attachment) allure.attachment(`Estado Rebote API`, JSON.stringify({ Status: finalStatus, Data: finalTx }, null, 2), "application/json");

        await allure.step("4. Visualizar Front (El saldo NUNCA debió moverse)", async () => {
            await loginAndCaptureDashboard(sharedPage, allure, false, 'AR');
        });

        expect(finalStatus).toBe('pending');
    });

    test('4. Over Pay (Abono Mayor Permitido): El cliente transfiere de más', async () => {
        const ordenAmount = 1500.00;
        const depositAmount = 2500.00; 
        
        await allure.step("1. Capturar Dashboard UI", async () => {
            await loginAndCaptureDashboard(sharedPage, allure, true, 'AR');
        });

        const payinInfo = await buildH2HPayin(ordenAmount, true); 
        if(!payinInfo.assignedCvu) return;
        
        const simRes = await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, depositAmount);
        expect([200, 201]).toContain(simRes.status);

        const finalTx = await waitForStatusUpdate(payinInfo.txId);
        const finalStatus = (finalTx.status || "").toLowerCase();
        
        if (allure && allure.attachment) allure.attachment(`Over Pay Tolerado API`, JSON.stringify({ Status: finalStatus, Data: finalTx }, null, 2), "application/json");

        await allure.step("4. Evidencia Frontend (Subió más capital del ordenado)", async () => {
            await loginAndCaptureDashboard(sharedPage, allure, false, 'AR');
        });

        expect(finalStatus).toMatch(/confirmed|completed/i);
    });

});
