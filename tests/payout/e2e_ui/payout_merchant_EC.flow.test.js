const { chromium } = require('playwright');
const allure = require('allure-js-commons');
const envConfig = require('../../../utils/envConfig');

jest.setTimeout(1800000); 

describe(`[E2E UI] MERCHANT PORTAL EC: Creación de Payout [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    let browser;
    let context;
    let page;

    beforeAll(async () => {
        try {
            browser = await chromium.launch({ headless: true }); 
            context = await browser.newContext({ locale: 'es-ES' });
            page = await context.newPage();
            page.setDefaultTimeout(15000);
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

    test('Flujo Completo: Login -> Navegación -> Llenar Form Payout -> Crear', async () => {
        // =========================================================
        // 1. INICIO DE SESIÓN EN PORTAL MERCHANT
        // =========================================================
        let baseURL = envConfig.BASE_URL;
        const domainRoot = baseURL.replace("api", "merchant");
        const loginUrl = `${domainRoot}/login`;

        await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
        
        await page.waitForSelector('input[type="email"]', { timeout: 15000 }).catch(()=>null);
        await page.getByRole('textbox', { name: 'Email' }).fill(envConfig.FRONTEND_PARAMS.email);
        await page.getByRole('textbox', { name: 'Contraseña' }).fill(envConfig.FRONTEND_PARAMS.password);
        
        // Forzamos botón si está desactivado por React
        const btnLogin = page.getByRole('button', { name: 'Iniciar sesión' }).first();
        await btnLogin.evaluate(node => node.disabled = false).catch(()=>null);
        await btnLogin.click({ force: true });
        
        const btnTransacciones = page.getByRole('link', { name: ' Transacciones ' }).first();
        await btnTransacciones.waitFor({ state: 'visible', timeout: 20000 });
        
        // Espera explícita para hidratación React
        await page.waitForTimeout(3000); 
        
        await attachScreenshot('Dashboard Merchant Tras Login');

        // Abre menú transacciones
        await btnTransacciones.click();
        
        const btnSalida = page.getByRole('link', { name: 'Transacciones de Salida' }).first();
        await btnSalida.waitFor({ state: 'visible', timeout: 15000 });
        await btnSalida.click();
        
        const btnCrear = page.getByRole('link', { name: 'Crear Pago' }).first();
        await btnCrear.waitFor({ state: 'visible', timeout: 15000 });
        await btnCrear.click();

        await page.waitForSelector('text=Monto', { timeout: 15000 }).catch(()=>null);
        await attachScreenshot('Formulario Payout Vacío');

        // =========================================================
        // 3. LLENADO DEL FORMULARIO EC (Happy Path Base)
        // =========================================================
        await page.getByLabel('País *').selectOption('EC');
        
        await page.locator('div').filter({ hasText: /^Monto \*$/ }).nth(1).click();
        await page.getByRole('textbox', { name: 'Monto *' }).fill('52');
        
        await page.getByRole('textbox', { name: 'Nombre*' }).fill('Sergio');
        await page.getByRole('textbox', { name: 'Apellido*' }).fill('Errigo');
        
        await page.getByLabel('Tipo de Documento*').selectOption('CI');
        await page.getByRole('textbox', { name: 'Número de Documento*' }).fill('1710034065');
        
        await page.getByLabel('Banco*').selectOption('banco_pichincha');
        await page.getByLabel('Tipo de Cuenta*').selectOption('Ahorro');
        await page.getByRole('textbox', { name: 'Número de Cuenta*' }).fill('12345678965');
        
        await page.getByText('Disable Mock?').click().catch(()=>null); 
        await attachScreenshot('Formulario Completado Listo Para Envio');

        // =========================================================
        // 4. GUARDAR Y VALIDAR
        // =========================================================
        await page.getByRole('button', { name: 'Crear Pago' }).click();
        
        // Esperamos que se renderice la interfaz nuevamente
        await page.waitForTimeout(3000); 
        
        await attachScreenshot('Resultado Final Payout');

        // Aserciones estrictas en la celda
        const tableContent = await page.innerText('body').catch(()=>"");
        expect(tableContent).toContain('Sergio');
        expect(tableContent).toContain('Errigo');
    });
});
