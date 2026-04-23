const { chromium } = require('playwright');
const { getAccessToken } = require('./utils/authHelper');
const envConfig = require('./utils/envConfig');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: 'es-ES', colorScheme: 'dark', viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    try {
        const token = await getAccessToken();
        const baseUrl = envConfig.BASE_URL;

        console.log("Logging into merchant portal...");
        await page.goto(`${baseUrl.replace("api", "merchant")}/login`);
        await page.evaluate((t) => { localStorage.setItem('access_token', t); }, token);
        await page.goto(`${baseUrl.replace("api", "merchant")}/transactions/out`);
        await page.waitForTimeout(5000);
        
        console.log("Looking for action buttons...");
        const buttons = await page.locator('button[id^="actions-btn-"]').all();
        if (buttons.length > 0) {
            console.log("Clicking first action button...");
            await buttons[0].click({ force: true });
            await page.waitForTimeout(2000);

            console.log("Visible text items on whole page:");
            const allItems = await page.locator('button, span, a, div, li').all();
            for (let el of allItems) {
                const text = await el.textContent().catch(()=>"");
                const visible = await el.isVisible().catch(()=>false);
                if (visible && text && text.trim().length > 0 && text.trim().length < 30) {
                    if (/fail|fall|rechaz|reject|cancel|expir|approv|aprob/i.test(text.trim())) {
                        console.log(`FOUND MATCH: "${text.trim()}"`);
                        console.log("HTML:", await el.evaluate(n => n.outerHTML).catch(()=>""));
                    }
                }
            }
        } else {
            console.log("No action buttons found.");
        }
        await page.screenshot({ path: 'debug_dropdown3.png', fullPage: true });

    } catch(e) {
        console.error("Error:", e);
    } finally {
        await browser.close();
    }
})();
