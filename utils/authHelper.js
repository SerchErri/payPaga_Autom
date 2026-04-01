const axios = require('axios');
const envConfig = require('./envConfig');

// Exportamos la función que autogestiona todo el proceso de tokens según el ambiente actual.
async function getAccessToken() {
    const url = `${envConfig.BASE_URL}/oauth2/token`;
    
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    // Tomamos inteligentemente el Client y el Secret del ambiente cargado
    params.append('client_id', envConfig.AUTH.clientId);
    params.append('client_secret', envConfig.AUTH.clientSecret);

    try {
        const response = await axios.post(url, params, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        return response.data.access_token;
    } catch (error) {
        console.error(`¡Error obteniendo el Access Token en el ambiente [${envConfig.currentEnvName.toUpperCase()}]! - Status:`, error.response?.status);
        console.error('Data:', error.response?.data);
        throw error;
    }
}

module.exports = {
    getAccessToken
};
