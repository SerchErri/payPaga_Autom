const axios = require('axios');
const allure = require('allure-js-commons');
// Importamos la configuración central que determinará si corremos DEV o STG
const envConfig = require('../../utils/envConfig');

const AUTH_URL = `${envConfig.BASE_URL}/oauth2/token`;

describe(`Autenticación - API de Paypaga [Ambiente Activo: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    test(`Llamada EXITOSA a /oauth2/token en ${envConfig.currentEnvName.toUpperCase()} (200 OK)`, async () => {
        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', envConfig.AUTH.clientId);
        params.append('client_secret', envConfig.AUTH.clientSecret);

        const response = await axios.post(AUTH_URL, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            validateStatus: () => true 
        });

        if (allure && allure.attachment) {
            await allure.attachment("A1. Payload Enviado", params.toString(), "text/plain");
            await allure.attachment("A2. Respuesta Backend (Éxito)", JSON.stringify(response.data, null, 2), "application/json");
        }

        expect(response.status).toBe(200);
        expect(response.data.access_token).toBeDefined();
        expect(response.data.access_token).not.toBe('');
    });

    test('Testing Negativo: Forzar error omitiendo el client_id', async () => {
        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_secret', envConfig.AUTH.clientSecret);

        const response = await axios.post(AUTH_URL, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            validateStatus: () => true 
        });

        if (allure && allure.attachment) {
            await allure.attachment("B1. Payload Problemático Omitiendo Client_id", params.toString(), "text/plain");
            await allure.attachment("B2. Mensaje de Error Capturado", JSON.stringify(response.data, null, 2), "application/json");
        }

        expect([400, 401]).toContain(response.status);
        expect(response.data.error).toBeDefined();
    });

    test('Testing Negativo: Forzar error omitiendo el client_secret', async () => {
        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', envConfig.AUTH.clientId);

        const response = await axios.post(AUTH_URL, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            validateStatus: () => true 
        });

        if (allure && allure.attachment) {
            await allure.attachment("C1. Payload Problemático Omitiendo Secret", params.toString(), "text/plain");
            await allure.attachment("C2. Mensaje de Error Capturado", JSON.stringify(response.data, null, 2), "application/json");
        }

        expect([400, 401]).toContain(response.status);
        expect(response.data.error).toBeDefined();
    });

    test('Testing Negativo: Forzar error omitiendo el grant_type', async () => {
        const params = new URLSearchParams();
        params.append('client_id', envConfig.AUTH.clientId);
        params.append('client_secret', envConfig.AUTH.clientSecret);

        const response = await axios.post(AUTH_URL, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            validateStatus: () => true 
        });

        if (allure && allure.attachment) {
            await allure.attachment("D1. Payload Omitiendo grant_type", params.toString(), "text/plain");
            await allure.attachment("D2. Mensaje de Error Esperado", JSON.stringify(response.data, null, 2), "application/json");
        }

        expect([400, 401]).toContain(response.status);
        expect(response.data.error).toBeDefined();
    });

    test('Testing Negativo: Forzar Access Denied con Credenciales Mixtas (Mismatch)', async () => {
        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', envConfig.AUTH.clientId); 
        params.append('client_secret', 'FALSO_SECRET_QUE_NO_CORRESPONDE_PARA_GENERAR_UN_MISMATCH'); 

        const response = await axios.post(AUTH_URL, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            validateStatus: () => true 
        });

        if (allure && allure.attachment) {
            await allure.attachment("E1. Payload Mismatching", params.toString(), "text/plain");
            await allure.attachment("E2. Error de Rechazo por Seguridad (Mismatch)", JSON.stringify(response.data, null, 2), "application/json");
        }

        expect([400, 401, 403]).toContain(response.status);
        expect(response.data.error).toBeDefined();
    });

});
