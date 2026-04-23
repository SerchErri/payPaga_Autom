const { chromium } = require('playwright');
const { getAccessToken } = require('./utils/authHelper');
const envConfig = require('./utils/envConfig');
const axios = require('axios');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: 'es-ES', colorScheme: 'dark', viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    try {
        const token = await getAccessToken();
        const baseUrl = envConfig.BASE_URL;

        // Origin a payout to ensure we have a transaction on top
        console.log("Generating dummy payout...");
        const payload = {
            amount: 2500, country: 'AR', currency: 'ARS', payment_method: 'cvu',
            merchant_order_reference: `DEBUG-${Date.now()}`,
            merchant_transaction_reference: `DEBUG-${Date.now()}`,
            merchant_customer_id: 'customer@email.com', customer_ip: "120.29.48.92",
            fields: { first_name: 'Sergio', last_name: 'Test', document_number: '20275105792', account_number: '0070327530004025541644' }
        };
        const res = await axios.post(`${baseUrl}/v2/transactions/pay-out`, payload, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'DisablePartnerMock': 'true' }
        });
        const txId = res.data.transaction_id || res.data.id || (res.data.details && res.data.details.transaction_processed && res.data.details.transaction_processed.transaction_id);
        console.log("Transaction ID:", txId);

        console.log("Logging into merchant portal...");
        await page.goto(`${baseUrl.replace("api", "merchant")}/login`);
        await page.evaluate((t) => { localStorage.setItem('access_token', t); }, token);
        await page.goto(`${baseUrl.replace("api", "merchant")}/transactions/out`);
        await page.waitForTimeout(5000);
        
        console.log("Clicking action button...");
        await page.locator(`#actions-btn-${txId}`).click({ force: true });
        await page.waitForTimeout(2000);

        const items = await page.locator('.dropdown-menu, .mat-menu-panel, [role="menu"]').locator('li, button, a').allTextContents();
        console.log("Dropdown text items found inside menu containers:");
        console.log(items.map(t => t.trim()).filter(t => t));

        console.log("Visible text items on whole page matching regex:");
        const regexStr = /fail|fall|rechaz|reject|cancel|expir|approv|aprob/i;
        const allMatching = await page.locator('button, span, a, div').filter({ hasText: regexStr }).all();
        for (let el of allMatching) {
             const visible = await el.isVisible();
             const text = await el.textContent();
             if(text && text.trim().length < 30) console.log(`Visible: ${visible}, Text: ${text.trim()}`);
        }
        
        await page.screenshot({ path: 'debug_dropdown2.png', fullPage: true });

    } catch(e) {
        console.error("Error:", e);
    } finally {
        await browser.close();
    }
})();
