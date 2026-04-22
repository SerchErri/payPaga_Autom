const { chromium } = require('playwright');
const axios = require('axios');
const { getAccessToken } = require('./utils/authHelper');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
        let token = await getAccessToken();
        const payload = {
            "amount": 1000, "country": "AR", "currency": "ARS", "payment_method": "cvu", 
            "merchant_transaction_reference": `DEBUG-${Date.now()}`,
            "merchant_customer_id": "dinaria_sandbox@paypaga.com",
            "allowOverUnder": false,
            "fields": { "first_name": "Jon", "last_name": "Snow", "document_number": "20275105792", "document_type": "CUIL", "email": "dinaria_sandbox@paypaga.com" }
        };
        const res = await axios.post('https://api.v2.dev.paypaga.com/v2/transactions/pay-in', payload, { headers: { 'DisablePartnerMock': 'true', Authorization: 'Bearer '+token }});
        const txId = res.data.transaction_id || res.data.id;
        
        await page.goto("https://admin.v2.dev.paypaga.com/login");
        await page.fill('input[type="email"]', "serrigo@paypaga.com");
        await page.fill('input[type="password"]', "P@assword.");
        await page.click('button[type="submit"]');
        await page.waitForTimeout(4000);
        await page.goto("https://admin.v2.dev.paypaga.com/transactions/pay-in");
        await page.waitForTimeout(4000);

        await page.locator('input[placeholder*="Search"], input[placeholder*="Buscar"]').first().fill(txId);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);
        
        const actionBtn = page.locator(`#actions-btn-${txId}`).first();
        await actionBtn.click({ force: true });
        await page.waitForTimeout(1000);

        const stateBtn = page.getByText(/expire|expirada/i).first();
        await stateBtn.click({ force: true });
        await page.waitForTimeout(2000);
        
        const dump = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.innerText).filter(t => t.length > 0).join(' | '));
        console.log('MODAL BUTTONS:', dump);
    } catch(e) { console.error(e); }
    await browser.close();
})();
