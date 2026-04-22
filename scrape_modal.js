const { chromium } = require('playwright');
const envConfig = require('./utils/envConfig');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto('https://admin.v2.dev.paypaga.com/login');
    await page.fill('input[type="email"]', envConfig.FRONTEND_PARAMS.email || 'serrigo@paypaga.com');
    await page.fill('input[type="password"]', envConfig.FRONTEND_PARAMS.password || 'P@assword.');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
    
    await page.goto(`https://admin.v2.dev.paypaga.com/merchants/${envConfig.FRONTEND_PARAMS.merchantId}/partners`);
    await page.waitForTimeout(4000);
    
    await page.selectOption('select#partners-country-select', 'AR').catch(() => {});
    await page.waitForTimeout(2000);
    await page.selectOption('select#partners-method-select', 'cvu').catch(() => {});
    await page.waitForTimeout(2000);
    
    const txt = await page.evaluate(() => document.querySelector('table').innerText);
    console.log("TABLE TEXT:", txt);
    
    const btn = page.locator('table tbody tr:first-child td:last-child').locator('a, button').first();
    await btn.click({ force: true });
    await page.waitForTimeout(2000);
    
    const panelHtml = await page.evaluate(() => document.getElementById('partner-config-panel').innerHTML);
    const fs = require('fs');
    fs.writeFileSync('modal.html', panelHtml);
    await browser.close();
    console.log("MODAL_EXTRACTED");
})();
