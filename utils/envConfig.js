// utils/envConfig.js
// Archivo central para gestionar de manera segura los datos de ambos ambientes.

const ENV = process.env.TEST_ENV || 'dev'; // Dev por defecto si no se pasa nada en consola

const config = {
    dev: {
        BASE_URL: 'https://api.v2.dev.paypaga.com',
        FRONTEND_PARAMS: {
            email: 'automation.qa.v1@gmail.com',
            password: 'Sergio@1234',
            merchantId: '370914c8-c42a-4309-b50c-45656ad50b7c'
        },
        AUTH: {
            clientId: '4e9ac30a-edda-4806-a0cf-b648eadc5399',
            clientSecret: 'qZnq5X-qtbzQIhD97fzyujXw74sw-hgs'
        },
        AUTH_MERCHANT_B: {
            merchantId: 'fe3ef6a2-12cc-4861-a705-16eec96aa8a2',
            clientId: '8355aaed-61e0-43fb-86ba-f5017a816e68',
            clientSecret: 'tssBYxj79bsd2iknnMJpK41a9OVVgQY6'
        }
    },
    stg: {
        BASE_URL: 'https://api.v2.stg.paypaga.com',
        FRONTEND_PARAMS: {
            email: 'automation.qa.v1@gmail.com',
            password: 'Sergio@1234',
            merchantId: '2721281b-ecde-437d-843f-cf457ec7c450'
        },
        AUTH: {
            clientId: '7215b806-c71b-4fcf-8e57-67263dd3ae20',
            clientSecret: 'NX8yLQB4bc-Z79zSlfgZB-XE73ffD45P'
        }
    }
};

// Si piden un ambiente que no existe, forzamos un error descriptivo
if (!config[ENV]) {
    throw new Error(`¡ATENCIÓN! El ambiente seleccionado '${ENV}' no es válido. Usa 'dev' o 'stg'.`);
}

module.exports = {
    currentEnvName: ENV, // "dev" o "stg"
    ...config[ENV]
};
