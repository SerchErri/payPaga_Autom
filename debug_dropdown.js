const { chromium } = require('playwright');
const { getAccessToken } = require('./utils/authHelper');
const envConfig = require('./utils/envConfig');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: 'es-ES', colorScheme: 'dark', viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    try {
        const token = await getAccessToken();
        const baseUrl = envConfig.BASE_URL.replace("api", "merchant");
        
        console.log("Logging into merchant portal...");
        await page.goto(`${baseUrl}/login`);
        await page.evaluate((t) => {
            localStorage.setItem('access_token', t);
        }, token);
        
        console.log("Navigating to transactions out...");
        await page.goto(`${baseUrl}/transactions/out`);
        await page.waitForLoadState('networkidle');
        
        console.log("Waiting for table to load...");
        await page.waitForTimeout(5000);
        
        const rows = await page.locator('tbody tr').all();
        console.log(`Found ${rows.length} rows.`);
        if (rows.length === 0) {
            console.log("No rows found.");
            await browser.close();
            return;
        }

        const actionBtn = rows[0].locator('button').last();
        console.log("Clicking action button...");
        await actionBtn.click({ force: true });
        
        await page.waitForTimeout(2000); // let menu open

        console.log("Reading dropdown items...");
        const menuItems = await page.locator('[role="menuitem"], .mat-mdc-menu-item').allTextContents();
        console.log("Menu Items:", menuItems);

        await page.screenshot({ path: 'debug_dropdown.png', fullPage: true });
        console.log("Saved debug_dropdown.png");
    } catch(e) {
        console.error("Error:", e);
    } finally {
        await browser.close();
    }
})();
