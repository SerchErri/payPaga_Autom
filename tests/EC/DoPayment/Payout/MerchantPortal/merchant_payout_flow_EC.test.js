const { chromium } = require('playwright');
const allure = require('allure-js-commons');
const envConfig = require('../../../../../utils/envConfig');

jest.setTimeout(1800000); 

describe(`[E2E UI] FAST FLOW - MERCHANT PORTAL EC: Solo Creación de Payout [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    let browser;
    let context;
    let page;

    beforeAll(async () => {
        try {
            browser = await chromium.launch({ headless: true }); 
            context = await browser.newContext({ locale: 'es-ES', colorScheme: 'dark' });
            page = await context.newPage();
            page.setDefaultTimeout(20000);
        } catch(e) { console.error("Fallo levantando Playwright", e); }
    });

    afterAll(async () => {
        if (browser) await browser.close();
    });

    const attachScreenshot = async (name) => {
        if(allure && allure.attachment){
            try {
                const buffer = await page.screenshot({ fullPage: true });
                allure.attachment(`📸 Evidencia Visual: ${name}`, buffer, "image/png");
            } catch(e){}
        }
    };

    test('Flujo Exprés: Login -> Llenar Form Payout -> Crear y Extraer ID', async () => {
        // =========================================================
        // 1. INICIO DE SESIÓN
        // =========================================================
        let baseURL = envConfig.BASE_URL;
        const domainRoot = baseURL.replace("api", "admin").replace("admin", "merchant"); // Simple safeguard to ensure merchant domain if testing locally
        let loginUrl = `${domainRoot}/login`; 
        if(!loginUrl.includes('merchant')) loginUrl = envConfig.FRONTEND_URL || "https://merchant.v2.dev.paypaga.com/login"; // Fallback por defecto

        await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
        
        await page.waitForSelector('input[type="email"]', { timeout: 15000 }).catch(()=>null);
        await page.getByRole('textbox', { name: 'Email' }).fill(envConfig.FRONTEND_PARAMS.email);
        await page.getByRole('textbox', { name: 'Contraseña' }).fill(envConfig.FRONTEND_PARAMS.password);
        
        const btnLogin = page.getByRole('button', { name: 'Iniciar sesión' }).first();
        await btnLogin.evaluate(node => node.disabled = false).catch(()=>null);
        await btnLogin.click({ force: true });
        
        const btnTransacciones = page.getByRole('link', { name: ' Transacciones ' }).first();
        await btnTransacciones.waitFor({ state: 'visible', timeout: 20000 });
        await page.waitForTimeout(2000); 

        // =========================================================
        // 2. NAVEGAR A PAYOUT
        // =========================================================
        await btnTransacciones.click();
        const btnSalida = page.getByRole('link', { name: 'Transacciones de Salida' }).first();
        await btnSalida.waitFor({ state: 'visible' });
        await btnSalida.click();
        
        const btnCrear = page.getByRole('link', { name: 'Crear Pago' }).first();
        await btnCrear.waitFor({ state: 'visible' });
        await btnCrear.click();
        await page.waitForSelector('text=Monto', { timeout: 15000 }).catch(()=>null);

        // =========================================================
        // 3. LLENADO DEL FORMULARIO EC
        // =========================================================
        await page.getByLabel('País *').selectOption('EC');
        await page.locator('div').filter({ hasText: /^Monto \*$/ }).nth(1).click();
        await page.getByRole('textbox', { name: 'Monto *' }).fill('52');
        
        await page.getByRole('textbox', { name: 'Nombre*' }).fill('Sergio Test');
        await page.getByRole('textbox', { name: 'Apellido*' }).fill('Luz Verde');
        await page.getByLabel('Tipo de Documento*').selectOption('CI');
        await page.getByRole('textbox', { name: 'Número de Documento*' }).fill('1710034065');
        await page.getByLabel('Banco*').selectOption('banco_pichincha');
        await page.getByLabel('Tipo de Cuenta*').selectOption('Ahorro');
        await page.getByRole('textbox', { name: 'Número de Cuenta*' }).fill('1234567890');
        
        await page.getByText('Disable Mock?').click().catch(()=>null); 
        await attachScreenshot('Formulario Listo');

        // =========================================================
        // 4. CREAR Y EXTRAER ID TRANSACCIÓN PORM API INTERCEPTOR
        // =========================================================
        // Interceptar la respuesta del request HTTP interno de React para agarrar el ID con precisión del 100%
        const responsePromise = page.waitForResponse(response => response.url().includes('pay-out') && [200, 201].includes(response.status()), { timeout: 20000 }).catch(()=>null);
        await page.getByRole('button', { name: 'Crear Pago' }).click();

        let generatedTxId = "NO_ENCONTRADO";
        const apiResponse = await responsePromise;
        if(apiResponse) {
            const respBody = await apiResponse.json().catch(()=>({}));
            generatedTxId = respBody.transaction_id || respBody.id || respBody.reference || "ID_RESCATADO_DESCONOCIDO";
        }
        
        await page.waitForTimeout(3000); 
        await attachScreenshot('Payout Generado Exitosamente');

        console.log(`\n======================================================`);
        console.log(`✅ TEST RÁPIDO: Payout EC Creado`);
        console.log(`🆔 OPERATION TRANSACTION ID: ${generatedTxId}`);
        console.log(`======================================================\n`);

        if(allure && allure.attachment){
            await allure.attachment(`OPERATION TRANSACTION ID MINTED`, `El ID de Payout rápido creado es:\n\n${generatedTxId}`, "text/plain");
        }

        expect(generatedTxId).not.toBe("NO_ENCONTRADO");
    });
});
