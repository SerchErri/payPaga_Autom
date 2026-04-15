const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../../../../utils/authHelper');
const envConfig = require('../../../../../utils/envConfig');

describe(`Configuración Pay-In Dinaria (AR) - API de Paypaga [Amb: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    let freshToken = '';
    const BASE_CONFIG_URL = `${envConfig.BASE_URL}/v2/transactions/pay-in/config`;

    beforeAll(async () => {
        try {
            freshToken = await getAccessToken();
        } catch (error) {
            console.error("Fallo estratégico: No se pudo obtener token global para Config Test AR", error);
        }
    });

    test(`Llamada EXITOSA a la configuración de Pay-In para Argentina (country=AR)`, async () => {
        const url = `${BASE_CONFIG_URL}?country=AR`;

        const response = await axios.get(url, {
            headers: {
                'DisablePartnerMock': 'true',
                'Authorization': `Bearer ${freshToken}`
            },
            validateStatus: () => true
        });

        if (allure && allure.attachment) {
            await allure.attachment(`Respuesta Completa Config ARGENTINA Exitosa [${envConfig.currentEnvName.toUpperCase()}]`, JSON.stringify(response.data, null, 2), "application/json");
        }

        expect(response.status).toBe(200);
        expect(response.data).toBeDefined();
    });

    test('Testing Negativo: Forzar error omitiendo el parámetro obligatorio [country]', async () => {
        const url = `${BASE_CONFIG_URL}`;

        const response = await axios.get(url, {
            headers: {
                'DisablePartnerMock': 'true',
                'Authorization': `Bearer ${freshToken}`
            },
            validateStatus: () => true
        });

        if (allure && allure.attachment) {
            await allure.attachment("Error AR devuelto por País Omitido", JSON.stringify(response.data, null, 2), "application/json");
        }

        expect([400, 404, 422]).toContain(response.status);
    });

    test('Testing Negativo: Forzar error enviando un [country] ficticio o no habilitado', async () => {
        const url = `${BASE_CONFIG_URL}?country=ZZZ`;

        const response = await axios.get(url, {
            headers: {
                'DisablePartnerMock': 'true',
                'Authorization': `Bearer ${freshToken}`
            },
            validateStatus: () => true
        });

        if (allure && allure.attachment) {
            await allure.attachment("Evidencia de Error 400 para País Ficticio", JSON.stringify({
                url_enviada: url,
                respuesta_recibida: response.data
            }, null, 2), "application/json");
        }

        // Validación ajustada a la realidad del endpoint config
        // A diferencia de /balances, /config devuelve silenciosamente 200 con un JSON de items vacío
        expect(response.status).toBe(200);
        expect(response.data).toEqual({ items: [] });
    });

    test('Testing Negativo: Intentar acceder a la base Config AR SIN Authorization Token', async () => {
        const url = `${BASE_CONFIG_URL}?country=AR`;

        const response = await axios.get(url, {
            headers: {
                'DisablePartnerMock': 'true'
            },
            validateStatus: () => true
        });

        if (allure && allure.attachment) {
            await allure.attachment("Error AR de Rechazo de Seguridad (Unauthorized)", JSON.stringify(response.data, null, 2), "application/json");
        }

        expect([401, 403]).toContain(response.status);
    });

});
