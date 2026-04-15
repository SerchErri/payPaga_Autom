const { chromium } = require('playwright');
const allure = require('allure-js-commons');
const envConfig = require('../../../../../utils/envConfig');
const { loginAndCaptureDashboard, fastAdminApprove } = require('../../../../../utils/uiBalanceHelper');

// Tiempo global amplio porque es un flujo larguísimo de front-end
jest.setTimeout(1800000);

describe(`MERCHANT PORTAL EC: Creación de Payment Link en [Amb: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    let browser;
    let context;
    let page;
    let initialBalances = {};
    let payinTestAmount = 100;

    beforeAll(async () => {
        try {
            // Se lanza el navegador
            browser = await chromium.launch({ headless: true });
            context = await browser.newContext({ locale: 'es-ES', colorScheme: 'dark' });
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

    test('Flujo Completo: UI Saldos -> Rellenar Formulario -> Validar Tabla -> Interceptar Safetypay', async () => {
        // =========================================================
        // 1. INICIO DE SESIÓN Y REGISTRO DE SALDOS INICIALES
        // =========================================================
        initialBalances = await loginAndCaptureDashboard(page, allure, true);
        console.log("📈 SALDOS INICIALES PAYIN (UI):", initialBalances);

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

        // =========================================================
        // 6. BUSCAR TRANSACCIÓN EN GRILLA, EXTRAER ID Y APROBAR
        // =========================================================
        // Volvemos a la pestaña original de Merchant Portal
        await page.bringToFront();

        const btnTransacciones = page.getByRole('link', { name: ' Transacciones ' }).first();
        await btnTransacciones.click({ force: true }).catch(()=>null);
        await page.waitForTimeout(1000);
        
        const btnEntradas = page.getByRole('link', { name: 'Transacciones de Entrada' }).first();
        await btnEntradas.click({ force: true }).catch(()=>null);

        // Esperamos agresivamente a que el sistema agregue la fila a la tabla UI
        await page.waitForTimeout(4000); 

        // Raspamos el ID buscando en la tabla visible
        const generatedTxId = await page.evaluate(() => {
            const uuidRegex = /[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/;
            const elements = document.body.innerText.match(uuidRegex);
            return elements ? elements[0] : null;
        });

        if (!generatedTxId) {
            console.warn("⚠️ No se encontró UUID en la tabla de Transacciones de Entrada. Puede que la inserción se demore.");
        } else {
            console.log(`\n🔗 PayIn Transaction ID Encontrado en Grilla: ${generatedTxId}`);
            if (allure && allure.attachment) allure.attachment('PayIn ID', generatedTxId, 'text/plain');
            
            // Aprobar forzosamente por Admin
            await fastAdminApprove(page, generatedTxId, 'pay-in', allure);
        }

        // =========================================================
        // 7. VOLVER AL DASHBOARD Y VALIDAR IMPACTO DE SALDOS
        // =========================================================
        const finalBalances = await loginAndCaptureDashboard(page, allure, false);
        console.log("📈 SALDOS FINALES PAYIN TRAS APROBACIÓN:", finalBalances);

        // De acuerdo al Excel: Initial + Payin = Sube
        expect(finalBalances.available).toBeGreaterThan(initialBalances.available);
        expect(finalBalances.volume).toBeGreaterThan(initialBalances.volume);
        expect(finalBalances.fees !== initialBalances.fees).toBeTruthy();
        expect(finalBalances.taxes !== initialBalances.taxes).toBeTruthy();
        
        if (allure && allure.attachment) {
            await allure.attachment(`Comparativa PayIn EC`, JSON.stringify({ SALDOS_INICIALES: initialBalances, SALDOS_FINALES: finalBalances }, null, 2), "application/json");
        }
    });
});
