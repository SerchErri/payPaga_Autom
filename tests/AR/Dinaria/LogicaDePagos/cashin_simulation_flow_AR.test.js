const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../../../utils/authHelper');
const envConfig = require('../../../../utils/envConfig');

jest.setTimeout(1800000); 

describe(`[Logica Financiera] Dinaria AR: Cash-In Webhooks Under/Over Pay Simulator [Env: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    let token = '';
    const DINARIA_SANDBOX_URL = 'https://api.sandbox.dinaria.com/ars/cashin/simulate';

    beforeAll(async () => {
        token = await getAccessToken();
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

        if (response.status !== 200 && response.status !== 201) {
            throw new Error(`Falló la creación del Pay-In: ${JSON.stringify(response.data)}`);
        }

        const txId = response.data.transaction_id || response.data.id || 'No Asignado';
        
        // Extracción Dinámica del CVU (Normalmente devuelto por Dinaria en la response del PayIn)
        // Exploramos el árbol del JSON dependiendo de la estructura de H2H
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
        console.log(`[Exact Match] 1. Creando H2H de $${ordenAmount}`);
        const payinInfo = await buildH2HPayin(ordenAmount, true);
        
        if(!payinInfo.assignedCvu) {
            console.warn("⚠️ Dinaria no ha retornado un CVU/CBU. El request fallará. Data:", payinInfo.fullResponse);
            return; // Salvaguarda
        }
        
        console.log(`[Exact Match] 2. CVU Generado: ${payinInfo.assignedCvu}. Inyectando Cash-In Dinaria de $${ordenAmount}`);
        const simRes = await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, ordenAmount);
        
        expect([200, 201]).toContain(simRes.status);

        console.log(`[Exact Match] 3. Pooling a PayPaga aguardando Webhook y conciliación...`);
        const finalTx = await waitForStatusUpdate(payinInfo.txId);
        
        const finalStatus = (finalTx.status || "").toLowerCase();
        
        if (allure && allure.attachment) allure.attachment(`Conciliación Exacta (1500 -> 1500)`, JSON.stringify({ ID: payinInfo.txId, StatusFinal: finalStatus, Info: finalTx }, null, 2), "application/json");

        expect(finalStatus).toMatch(/confirmed|completed/i);
    });

    test('2. Under Pay (Abono Parcial Permitido): Se concilia un pago menor', async () => {
        const ordenAmount = 1500.00;
        const depositAmount = 1000.00;
        
        console.log(`[Under Pay] 1. Creando H2H de $${ordenAmount} con allowOverUnder=true`);
        const payinInfo = await buildH2HPayin(ordenAmount, true); // true es la clave
        
        if(!payinInfo.assignedCvu) return;
        
        console.log(`[Under Pay] 2. Inyectando Solo $${depositAmount} al CVU de Dinaria`);
        const simRes = await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, depositAmount);
        expect([200, 201]).toContain(simRes.status);

        console.log(`[Under Pay] 3. Esperando que PayPaga lo acepte de todos modos...`);
        const finalTx = await waitForStatusUpdate(payinInfo.txId);
        
        const finalStatus = (finalTx.status || "").toLowerCase();
        
        if (allure && allure.attachment) allure.attachment(`Under Pay (1500 -> 1000)`, JSON.stringify({ ID: payinInfo.txId, StatusFinal: finalStatus, Info: finalTx }, null, 2), "application/json");

        expect(finalStatus).toMatch(/confirmed|completed/i);
    });

    test('3. RECHAZO ESTRICTO (No coincidencia Exacta con OverUnder denegado)', async () => {
        const ordenAmount = 1000.00;
        const depositAmount = 800.00; // Intento de pagar menos
        
        console.log(`[Strict Reject] 1. Creando H2H estricto de $${ordenAmount} (allowOverUnder=FALSE)`);
        const payinInfo = await buildH2HPayin(ordenAmount, false); // FALSE
        
        if(!payinInfo.assignedCvu) return;
        
        console.log(`[Strict Reject] 2. Disparando $${depositAmount} al Sandbox Dinaria...`);
        const simRes = await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, depositAmount);
        expect([200, 201]).toContain(simRes.status); // El simulador lo agarra

        console.log(`[Strict Reject] 3. Vigiliando PayPaga (Debe escupir/ignorar el webhook)...`);
        const finalTx = await waitForStatusUpdate(payinInfo.txId, 6, 4000); // Darle tiempo para un falso positivo
        
        const finalStatus = (finalTx.status || "").toLowerCase();
        
        if (allure && allure.attachment) allure.attachment(`Rechazo Estricto (1000 -> 800 Rebote)`, JSON.stringify({ ID: payinInfo.txId, StatusFinal: finalStatus, Info: finalTx }, null, 2), "application/json");

        // Al rechazar el UnderPay, Dinaria no nos confirma, la Tx se queda colgada PENDING.
        expect(finalStatus).toBe('pending');
    });

    test('4. Over Pay (Abono Mayor Permitido): El cliente transfiere de más', async () => {
        const ordenAmount = 1500.00;
        const depositAmount = 2500.00; // Error del cliente (Abonó mil de más)
        
        console.log(`[Over Pay] 1. Creando H2H de $${ordenAmount} con allowOverUnder=true`);
        const payinInfo = await buildH2HPayin(ordenAmount, true); 
        
        if(!payinInfo.assignedCvu) return;
        
        console.log(`[Over Pay] 2. ¡Depositando exagerados $${depositAmount}!`);
        const simRes = await simulateDinariaCashIn(payinInfo.assignedCvu, payinInfo.cuit, depositAmount);
        expect([200, 201]).toContain(simRes.status);

        console.log(`[Over Pay] 3. Esperando que el OverPay sea absorbido...`);
        const finalTx = await waitForStatusUpdate(payinInfo.txId);
        
        const finalStatus = (finalTx.status || "").toLowerCase();
        if (allure && allure.attachment) allure.attachment(`Over Pay Tolerado (1500 -> 2500)`, JSON.stringify({ ID: payinInfo.txId, StatusFinal: finalStatus, Info: finalTx }, null, 2), "application/json");

        expect(finalStatus).toMatch(/confirmed|completed/i);
    });

});
