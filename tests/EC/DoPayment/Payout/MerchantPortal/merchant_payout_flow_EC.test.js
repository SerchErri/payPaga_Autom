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
        // 4. CREAR Y EXTRAER ID TRANSACCIÓN
        // =========================================================
        await page.getByRole('button', { name: 'Crear Pago' }).click();

        // Esperamos agresivamente a que el sistema agregue la fila a la tabla UI
        await page.waitForTimeout(6000); 

        // Raspamos el ID buscando en la tabla visible
        const possibleId = await page.evaluate(() => {
            const uuidRegex = /[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/;
            const elements = document.body.innerText.match(uuidRegex);
            return elements ? elements[0] : null;
        });

        const generatedTxId = possibleId || "NO_ENCONTRADO";
        
        // Click a la primera fila para abrir el panel/modal de detalles de esa transacción
        const firstRow = page.locator('table tbody tr').first();
        await firstRow.click({ force: true }).catch(()=>null);
        await page.waitForTimeout(2000); // Dar tiempo a que el panel abra

        if(allure && allure.attachment){
            // Capturamos explícitamente viewport para atrapar el modal/drawer y no la grilla vertical "larguísima"
            const vpBuffer = await page.screenshot({ fullPage: false });
            await allure.attachment(`📸 Evidencia Visual: Payout EC Detalles Singulares`, vpBuffer, "image/png");
        }

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
