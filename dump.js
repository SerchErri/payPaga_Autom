const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto('https://admin.v2.dev.paypaga.com/login');
    await page.fill('input[type="email"]', 'serrigo@paypaga.com');
    await page.fill('input[type="password"]', 'P@assword.');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
    
    // Direct navigation using ID given by user
    await page.goto('https://admin.v2.dev.paypaga.com/merchants/370914c8-c42a-4309-b50c-45656ad50b7c/partners');
    await page.waitForTimeout(4000);
    
    // Select country and method
    await page.selectOption('select#partners-country-select', 'AR').catch(e => console.log('Country select skipped'));
    await page.waitForTimeout(2000);
    await page.selectOption('select#partners-method-select', 'cvu').catch(e => console.log('Method select skipped'));
    await page.waitForTimeout(2000);

    const html = await page.content();
    fs.writeFileSync('partners_dump_ui2.html', html);
    await browser.close();
    console.log('DUMP_SUCCESS_DOM2');
})();
