const { chromium } = require('playwright');
const envConfig = require('./utils/envConfig');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    let currentEnv = "dev";
    await page.goto(`https://admin.v2.${currentEnv}.paypaga.com/login`);
    await page.fill('input[type="email"]', "serrigo@paypaga.com");
    await page.fill('input[type="password"]', "P@assword.");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
    
    await page.goto(`https://admin.v2.${currentEnv}.paypaga.com/transactions/pay-in`);
    await page.waitForTimeout(4000);
    
    // find any row that is pending to click dropdown
    const btn = page.locator('button[id*="actions-btn"]').first();
    await btn.click({ force: true });
    await page.waitForTimeout(1000);
    
    const dropdownHtml = await page.evaluate(() => {
        // find active tooltip or overlay or just all role=menuitem
        const items = Array.from(document.querySelectorAll('a, button, li')).filter(el => el.innerText.trim().length > 0);
        return items.map(i => i.innerText).join(' | ');
    });
    console.log("DROPDOWN ITEMS:", dropdownHtml.substring(0, 1500));
    await browser.close();
})();
