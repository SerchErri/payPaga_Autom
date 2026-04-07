const axios = require('axios');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../utils/authHelper');
const envConfig = require('../../utils/envConfig');

describe(`Configuración Pay-In (Payment Config ECUADOR) - API de Paypaga [Amb: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    let freshToken = '';
    const BASE_CONFIG_URL = `${envConfig.BASE_URL}/v2/transactions/pay-in/config`;

    beforeAll(async () => {
        try {
            freshToken = await getAccessToken();
        } catch (error) {
            console.error("Fallo estratégico: No se pudo obtener token global para Config Test EC", error);
        }
    });

    test(`Llamada EXITOSA a la configuración de Pay-In para Ecuador (country=EC)`, async () => {
        const url = `${BASE_CONFIG_URL}?country=EC`;

        const response = await axios.get(url, {
            headers: {
                'DisablePartnerMock': 'true',
                'Authorization': `Bearer ${freshToken}`
            },
            validateStatus: () => true
        });

        if (allure && allure.attachment) {
            await allure.attachment(`Respuesta Completa Config ECUADOR Exitosa [${envConfig.currentEnvName.toUpperCase()}]`, JSON.stringify(response.data, null, 2), "application/json");
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
            await allure.attachment("Error EC devuelto por País Omitido", JSON.stringify(response.data, null, 2), "application/json");
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
            await allure.attachment("Error EC devuelto por País Inválido (ZZZ)", JSON.stringify(response.data, null, 2), "application/json");
        }

        expect([400, 404, 422]).toContain(response.status);
    });

    test('Testing Negativo: Intentar acceder a la base Config EC SIN Authorization Token', async () => {
        const url = `${BASE_CONFIG_URL}?country=EC`;

        const response = await axios.get(url, {
            headers: {
                'DisablePartnerMock': 'true'
            },
            validateStatus: () => true
        });

        if (allure && allure.attachment) {
            await allure.attachment("Error EC de Rechazo de Seguridad (Unauthorized)", JSON.stringify(response.data, null, 2), "application/json");
        }

        expect([401, 403]).toContain(response.status);
    });

});
