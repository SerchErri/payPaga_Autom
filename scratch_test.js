const axios = require('axios');
const { getAccessToken } = require('./utils/authHelper');

async function testBalance() {
    const token = await getAccessToken();
    const balRes = await axios.get(`https://api.v2.dev.paypaga.com/get_merchant_balance?country_code=AR&payment_method=cvu`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log(JSON.stringify(balRes.data, null, 2));
}

testBalance();
