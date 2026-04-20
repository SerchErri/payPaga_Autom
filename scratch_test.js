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
            "first_name": "Test",
            "last_name": "User",
            "document_number": "20275105792",
            "document_type": "CUIL",
            "email": "test@test.com"
        }
    };
    
    // Create
    const createRes = await axios.post(url, payload, { headers: { 'Authorization': `Bearer ${token}` }});
    const txId = createRes.data.transaction_id || createRes.data.id;
    console.log("Created TX:", txId);

    // Fetch attempt 1
    const fetchUrl1 = `${envConfig.BASE_URL}/v2/transactions/${txId}`;
    const res1 = await axios.get(fetchUrl1, { headers: { 'Authorization': `Bearer ${token}` }, validateStatus: () => true });
    console.log("Fetch /transactions/: ", res1.status, res1.data);
    
    // Fetch attempt 2
    const fetchUrl2 = `${envConfig.BASE_URL}/v2/transactions/pay-in/${txId}`;
    const res2 = await axios.get(fetchUrl2, { headers: { 'Authorization': `Bearer ${token}` }, validateStatus: () => true });
    console.log("Fetch /transactions/pay-in/: ", res2.status, res2.data);
}

test();
