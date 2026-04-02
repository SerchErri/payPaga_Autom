const axios = require('axios');
const { getAccessToken } = require('./utils/authHelper');

async function run() {
    try {
        const token = await getAccessToken();
        const payload = {
            "amount": 100.50,
            "currency": "USD",
            "country": "EC",
            "payment_method": "bank_transfer",
            "merchant_reference": "payout_test_ecuador_01",
            "description": "Pago de servicios - Test QA",
            "fields": {
                "first_name": "Sergio",
                "last_name": "Errigo",
                "document_type": "CI",
                "document_number": "1710034065",
                "bank_code": "banco_pichincha",
                "account_type": "ahorro",
                "account_number": "2201234567"
            }
        };

        const response = await axios.post('https://api.v2.dev.paypaga.com/v2/transactions/pay-out', payload, {
            headers: {
                'DisablePartnerMock': 'true',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            validateStatus: () => true
        });

        console.log("STATUS:", response.status);
        console.log("DATA:", JSON.stringify(response.data, null, 2));

    } catch (e) {
        console.error("Fetch failed", e);
    }
}
run();
