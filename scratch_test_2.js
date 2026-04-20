const axios = require('axios');
const { getAccessToken } = require('./utils/authHelper');
const envConfig = require('./utils/envConfig');

async function test() {
    const token = await getAccessToken();
    const url = `${envConfig.BASE_URL}/v2/transactions/pay-in`;
    const payload = {
        "amount": 1000,
        "country": "AR",
        "currency": "ARS",
        "payment_method": "cvu",
        "merchant_transaction_reference": `TEST-${Date.now()}`,
        "merchant_customer_id": "test@test.com",
        "fields": {
            "first_name": "Sergio",
            "last_name": "Test",
            "document_number": "20275105792",
            "document_type": "CUIL",
            "email": "test@test.com"
        }
    };
    
    // Create
    const createRes = await axios.post(url, payload, { headers: { 'Authorization': `Bearer ${token}` }});
    console.log(JSON.stringify(createRes.data, null, 2));
}

test();
