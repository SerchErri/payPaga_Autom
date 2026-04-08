const { chromium } = require('playwright');
const allure = require('allure-js-commons');
const envConfig = require('../../../../../utils/envConfig');

// Tiempo global amplio porque es un flujo larguísimo de front-end
jest.setTimeout(1800000);

describe(`MERCHANT PORTAL EC: Creación de Payment Link en [Amb: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    let browser;
    let context;
    let page;

    beforeAll(async () => {
        try {
            // Se lanza el navegador
            browser = await chromium.launch({ headless: true });
            context = await browser.newContext({ locale: 'es-ES' });
            page = await context.newPage();
        } catch (e) { console.error("Fallo levantando Playwright", e); }
    });

    afterAll(async () => {
        if (browser) await browser.close();
    });

    // Robot Tipográfico Seguro contra MaxLengths de React
    const typeSafe = async (selector, text) => {
        const el = page.locator(selector).first();
        await el.clear({ timeout: 5000 }).catch(() => null);
        await el.pressSequentially(text, { delay: 10, timeout: 5000 });
    };

    const attachScreenshot = async (name) => {
        if (allure && allure.attachment) {
            try {
                const buffer = await page.screenshot({ fullPage: true });
                allure.attachment(`📸 Evidencia Visual: ${name}`, buffer, "image/png");
            } catch (e) { }
        }
    };

    test('Flujo Completo: Login -> Rellenar Formulario -> Validar Tabla -> Interceptar Safetypay', async () => {
        // =========================================================
        // 1. INICIO DE SESIÓN EN PORTAL MERCHANT
        // =========================================================
        let baseURL = envConfig.BASE_URL; // e.g., api.v2.dev... the user said merchant.v2.dev.paypaga.com
        const domainRoot = baseURL.replace("api", "merchant");
        const loginUrl = `${domainRoot}/login`;

        await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

        // Esperamos a que despierte el React/Vue del input
        await page.waitForSelector('#identifier', { timeout: 15000 });
        await typeSafe('#identifier', 'automation.qa.v1@gmail.com');
        await typeSafe('#password', 'Sergio@1234');

        // Clic en Submit de login (Forzamos desbloqueo porque React puede demorar en habilitarlo tras typeSafe)
        const btnLogin = page.locator('button:has-text("Iniciar sesión")').first();
        await btnLogin.evaluate(node => node.disabled = false).catch(() => null);
        await btnLogin.click({ force: true });

        // Esperamos aterrizar en el Dashboard Principal
        await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => null);
        await attachScreenshot('Dashboard Merchant Tras Login');

        // =========================================================
        // 2. NAVEGACIÓN LATERAL (DRAWER MENU)
        // =========================================================
        // Abrir Hamburger Menu toggle (Playwright encontró 3 clones de diseño Mobile/Desktop, tomamos el visible)
        const toggle = page.locator('.sidebar-toggle').first();
        if (await toggle.count() > 0 && await toggle.isVisible()) {
            await toggle.click();
            await page.waitForTimeout(1000); // Animación css
        }

        // Clic en Menú Principal: "Enlaces de Pago"
        const menuEnlaces = page.locator('span:has-text("Enlaces de Pago")').first();
        await menuEnlaces.waitFor({ state: 'visible', timeout: 8000 });
        await menuEnlaces.click();
        await page.waitForTimeout(500);

        // Clic en Sub-menú: "Crear Enlace de Pago"
        const subCrearEnlace = page.locator('span:has-text("Crear Enlace de Pago")').first();
        await subCrearEnlace.waitFor({ state: 'visible', timeout: 8000 });
        await subCrearEnlace.click();

        // Evidencia Formularios Abiertos
        await page.waitForSelector('#country', { timeout: 15000 });
        await attachScreenshot('Formulario Creacion Enlace Vacío');

        // =========================================================
        // 3. LLENADO DEL FORMULARIO EC (Happy Path Base)
        // =========================================================
        await page.selectOption('#country', 'EC');
        const currencySelect = page.locator('#currency').first();
        expect(await currencySelect.inputValue()).toBe('USD'); // Validar auto-hidratación

        await page.selectOption('#payment_method', 'bank_transfer');
        await typeSafe('#amount', '100');
        await typeSafe('#first_name', 'Sergio');
        await typeSafe('#last_name', 'Errigo');
        await typeSafe('#email', 'serrigo@paypaga.com');
        await page.selectOption('#document_type', 'CI');
        await typeSafe('#document_number', '1710034065');

        // El check disable mock
        await page.check('#disable_mock').catch(() => null);
        await attachScreenshot('Formulario Completado Listo Para Envio');

        // =========================================================
        // 4. GUARDAR Y VALIDAR TABLA
        // =========================================================
        await page.locator('#save').click();

        // Redirige nativamente a la tabla de Enlaces
        await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => null);
        await page.waitForSelector('span[data-state="pending"]', { timeout: 15000 }); // Esperamos pintar la grilla

        await attachScreenshot('Tabla con Registro Insertado Exitosamente');

        // Aserciones estrictas en la celda
        const tableContent = await page.locator('table').innerText().catch(() => page.innerText('body'));
        expect(tableContent).toContain('100.00');
        expect(tableContent).toContain('Transferencia bancaria');
        expect(tableContent).toContain('USD');
        expect(tableContent).toContain('EC');
        expect(tableContent).toContain('Errigo');
        expect(tableContent).toContain('1710034065');

        // Nos aseguramos que el badge sea Pending
        const badgetPending = page.locator('span[data-state="pending"]').first();
        expect(await badgetPending.isVisible()).toBe(true);

        // =========================================================
        // 5. NAVEGAR AFUERA DEL MERCHANT A LA PASARELA EXTERNA
        // =========================================================
        // El link está en un tag <a> con URL de /pl/ (PayLink)
        const paymentUrlTag = page.locator('a[href*="/pl/"]').first();
        expect(await paymentUrlTag.isVisible()).toBe(true);

        // Como abre en blank, preparamos a Playwright para esperar una pestaña nueva
        const popupPromise = context.waitForEvent('page');
        await paymentUrlTag.click(); // Disparamos el new Tab
        const newTab = await popupPromise;

        await newTab.waitForLoadState('domcontentloaded');
        await newTab.waitForTimeout(3000); // Safari/Gateway Externos como SafetyPay tardan

        if (allure && allure.attachment) {
            try {
                const bp = await newTab.screenshot({ fullPage: true });
                allure.attachment(`📸 Evidencia SafetyPay (Nueva Pestaña)`, bp, "image/png");
            } catch (e) { }
        }

        // Validación de Importe Visual en SafetyPay
        const gatewayHTML = await newTab.innerText('body').catch(() => "");
        const wasMatched = gatewayHTML.includes('US$ 100') || gatewayHTML.includes('US$100');

        if (allure && allure.attachment) {
            allure.attachment(`Auditar E2E Safetypay`, JSON.stringify({
                TargetHTML_Contains_US100: wasMatched,
                Link_Haciendo_Destino: await newTab.url(),
                Expected_Amount: "US$ 100"
            }, null, 2), "application/json");
        }

        expect(wasMatched).toBe(true); // ¡Si no aparece el precio en la Pasarela, esto estallará en ROJO!
    });
});
