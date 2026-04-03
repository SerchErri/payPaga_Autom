const fs = require('fs');

const files = [
    'tests/payout/e2e_ui/payout_merchant_EC_interactivity.test.js',
    'tests/payin/e2e_ui/paymentlink_merchant_EC_interactivity.test.js'
];

files.forEach(path => {
    if (fs.existsSync(path)) {
        let content = fs.readFileSync(path, 'utf8');
        
        // El old code in both is roughly:
        // const attemptSubmit = async (page) => {
        //     await page.mouse.click(0, 0); ...
        
        // We will insert the pre-submit image logic at the beginning of attemptSubmit
        content = content.replace(
            /const attemptSubmit = async \(page\) => {/,
            `const attemptSubmit = async (page) => {
        if (allure && allure.attachment) {
            try {
                await page.waitForTimeout(500); 
                const buffer = await page.screenshot({ fullPage: true });
                allure.attachment("📸 Formulario Lleno (Antes de Enviar)", buffer, "image/png");
            } catch(e) {}
        }`
        );
        fs.writeFileSync(path, content, 'utf8');
        console.log('Patched: ' + path);
    }
});
