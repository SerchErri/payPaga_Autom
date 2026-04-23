const { chromium } = require('playwright');
const envConfig = require('./utils/envConfig');
const axios = require('axios');
const { getAccessToken } = require('./utils/authHelper');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
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
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'DisablePartnerMock': 'true' }, validateStatus: () => true
        });
        const txId = res.data.transaction_id || res.data.id || (res.data.details && res.data.details.transaction_processed && res.data.details.transaction_processed.transaction_id);
        console.log("Transaction ID:", txId);

        console.log("Logging into merchant portal...");
        await page.goto(`${baseUrl.replace("api", "merchant")}/login`);
        await page.fill('input[type="email"]', envConfig.MERCHANT_EMAIL);
        await page.fill('input[type="password"]', envConfig.MERCHANT_PASSWORD);
        await page.click('button[type="submit"]');
        await page.waitForTimeout(5000);

        console.log("Navigating to transactions out...");
        await page.goto(`${baseUrl.replace("api", "merchant")}/transactions/out`);
        await page.waitForTimeout(5000);
        
        console.log("Looking for action buttons...");
        const actionBtn = page.locator(`#actions-btn-${txId}`);
        if (await actionBtn.isVisible()) {
            console.log("Clicking action button...");
            await actionBtn.click();
            await page.waitForTimeout(2000);

            console.log("Visible text items on whole page:");
            const allItems = await page.locator('.dropdown-menu, .mat-mdc-menu-panel, [role="menu"]').locator('li, button, a, span').all();
            for (let el of allItems) {
                const text = await el.textContent().catch(()=>"");
                const visible = await el.isVisible().catch(()=>false);
                if (visible && text && text.trim().length > 0 && text.trim().length < 30) {
                    console.log(`Dropdown Option: "${text.trim()}"`);
                }
            }
        } else {
            console.log("Action button not visible!");
        }
        await page.screenshot({ path: 'debug_dropdown_real.png', fullPage: true });

    } catch(e) {
        console.error("Error:", e);
    } finally {
        await browser.close();
    }
})();
