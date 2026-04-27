const axios = require('axios');
const envConfig = require('./envConfig');

class AdminApiHelper {
    static async getAdminSessionCookie(email = 'serrigo@paypaga.com', password = 'P@assword.') {
        try {
            const params = new URLSearchParams();
            params.append('email', email);
            params.append('password', password);

            const currentEnv = (envConfig.currentEnvName || "dev").toLowerCase();
            const baseUrl = `https://admin.v2.${currentEnv}.paypaga.com`;

            const res = await axios.post(`${baseUrl}/login`, params, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                maxRedirects: 0,
                validateStatus: status => status >= 200 && status < 400
            });

            if (res.headers['set-cookie']) {
                return res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
            }
            throw new Error("No session cookie returned from Admin login.");
        } catch (error) {
            console.error("Admin Login Error:", error.message);
            throw error;
        }
    }

    static async getPartnerConfigState(cookie, merchantId, country = 'AR', method = 'cvu', partner = 'dinaria') {
        try {
            const currentEnv = (envConfig.currentEnvName || "dev").toLowerCase();
            const url = `https://admin.v2.${currentEnv}.paypaga.com/merchants/${merchantId}/partners?country=${country}&method=${method}&partner=${partner}`;

            const res = await axios.get(url, {
                headers: { 'Cookie': cookie }
            });

            const html = res.data || "";
            const isTrueSelected = html.includes('<option value="true" selected>');
            const isFalseSelected = html.includes('<option value="false" selected>');

            if (isTrueSelected) return true;
            if (isFalseSelected) return false;
            
            return null; // Unknown state
        } catch (error) {
            console.error("Error reading Admin config state:", error.message);
            return null;
        }
    }

    static async togglePartnerAllowOverUnder(cookie, merchantId, allowOverUnderValue, dinariaMerchantId = "sand_pay_merch3") {
        try {
            const currentEnv = (envConfig.currentEnvName || "dev").toLowerCase();
            const url = `https://admin.v2.${currentEnv}.paypaga.com/merchants/${merchantId}/partners/config`;

            const payload = {
                "country": "AR",
                "method": "cvu",
                "partner_id": "dinaria",
                "config": {
                    "allowOverUnder": allowOverUnderValue ? "true" : "false",
                    "merchantId": dinariaMerchantId
                }
            };

            const res = await axios.patch(url, payload, {
                headers: {
                    'Cookie': cookie,
                    'Content-Type': 'application/json'
                }
            });

            if (res.status === 200) {
                return true;
            }
            return false;
        } catch (error) {
            console.error("Error toggling Admin config:", error.message);
            return false;
        }
    }

    /**
     * Expira forzadamente una transacción desde el Admin Portal.
     * @param {string} cookie La cookie de sesión (e.g. "__session=...")
     * @param {string} merchantId El ID del merchant
     * @param {string} txId El ID de la transacción de Paypaga a expirar
     */
    static async expireTransaction(cookie, merchantId, txId) {
        try {
            const url = `https://admin.v2.dev.paypaga.com/transactions/pay-in/${txId}/expire?merchant_id=${merchantId}`;
            const res = await axios.get(url, {
                headers: {
                    'Cookie': cookie,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            return res.status === 200 || res.status === 204;
        } catch (error) {
            console.error(`❌ Error expirando transacción ${txId} en Admin API:`, error.message);
            return false;
        }
    }
}

module.exports = AdminApiHelper;
