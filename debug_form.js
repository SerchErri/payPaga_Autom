const { chromium } = require('playwright');
const axios = require('axios');
const { getAccessToken } = require('./tests/utils/authHelper'); // from root? wait, authHelper is in utils/authHelper.js
// Wait, path is `./utils/authHelper.js` from root
const envConfig = require('./utils/envConfig');

async function debug() {
    console.log("Starting Debug...");
    const token = await require('./utils/authHelper.js').getAccessToken();
    const payload = {
        "country": "EC",  "currency": "USD",  "amount": 100.00,
        "merchant_transaction_reference": `DEBUG-UI-${Date.now()}`,
        "merchant_customer_id": "cliente_ec@ejemplo.com", 
        "allowed_payment_methods": [ "bank_transfer" ],  
        "predefined_fields": [{ "payment_method": "bank_transfer", "fields": {} }]
    };
    const postRes = await axios.post(`${envConfig.BASE_URL}/v2/pay-urls`, payload, {
        headers: { 'DisablePartnerMock': 'true', 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    });
    
    console.log("PAYURL:", postRes.data.pay_url);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(postRes.data.pay_url, { waitUntil: 'networkidle' });
    
    console.log("Waiting 3s for hydration...");
    await page.waitForTimeout(3000);
    
    const countFirst = await page.locator('#first_name').count();
    console.log("Count #first_name:", countFirst);
    
    // Check if we need to click "Transferencia bancaria" visually to open the form
    const methodDiv = page.locator('div:has-text("Transferencia bancaria")').last();
    console.log("Method Div Count:", await methodDiv.count());
    
    if (countFirst === 0 && await methodDiv.count() > 0) {
        console.log("Clicking Method Div to see if form opens...");
        await methodDiv.click();
        await page.waitForTimeout(1000);
        console.log("Count #first_name AFTER CLICK:", await page.locator('#first_name').count());
    }
    
    const html = await page.content();
    console.log("HTML Extract length:", html.length);
    await browser.close();
}
debug().catch(console.error);
