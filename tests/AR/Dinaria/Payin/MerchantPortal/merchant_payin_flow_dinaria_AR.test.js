const { chromium } = require('playwright');
const allure = require('allure-js-commons');
const envConfig = require('../../../../../utils/envConfig');
const { loginAndCaptureDashboard, fastAdminAction } = require('../../../../../utils/uiBalanceHelper');

jest.setTimeout(1800000); // 30 Minutos

describe(`MERCHANT PORTAL AR: Payin Manual Flow (Dinaria) [Amb: ${envConfig.currentEnvName.toUpperCase()}]`, () => {

    let browser;
    let context;
    let page;
    let initialBalances = {};
    const transactionAmount = 1200.54;

    beforeAll(async () => {
        try {
            browser = await chromium.launch({ headless: true });
            context = await browser.newContext({ locale: 'es-ES', colorScheme: 'dark' });
            page = await context.newPage();
            page.setDefaultTimeout(30000);
        } catch (e) { console.error("Fallo levantando Playwright", e); }
    });

    afterAll(async () => {
        if (browser) await browser.close();
    });

    // Escritura Segura Front-End React
    const typeSafe = async (selector, text) => {
        const el = page.locator(selector).first();
        if (await el.isVisible().catch(() => false)) {
            await el.clear({ timeout: 5000 }).catch(() => null);
            await el.pressSequentially(text, { delay: 10, timeout: 5000 });
        }
    };

    const attachScreenshot = async (name) => {
        if (allure && allure.attachment) {
            try {
                await page.waitForTimeout(1000);
                const buffer = await page.screenshot({ fullPage: true });
                allure.attachment(`📸 Evidencia UI: ${name}`, buffer, "image/png");
            } catch (e) { }
        }
    };

    test('Omnichannel: UI ARS Saldos -> UI Merchant Creacion -> Checkout Voucher UI -> Admin Approve -> Extracción Saldos', async () => {
        // =========================================================
        // 1. INICIO DE SESIÓN Y REGISTRO DE SALDOS (ARS)
        // =========================================================
        console.log("-----------------------------------------");
        console.log("➡️ Paso 1: Logueo en Merchant V2 y Rastreo de Saldo Inicial");
        initialBalances = await loginAndCaptureDashboard(page, allure, true, 'AR');
        console.log(`📈 SALDOS INICIALES CREADOS: ${JSON.stringify(initialBalances)}`);
        
        await attachScreenshot('Dashboard Merchant (Balance ARS)');

        // =========================================================
        // 2. NAVEGACIÓN LATERAL A "ENLACES DE PAGO"
        // =========================================================
        console.log("➡️ Paso 2: Navegación por Drawer hacia Creador de Enlaces");
        const toggle = page.locator('.sidebar-toggle').first();
        if (await toggle.count() > 0 && await toggle.isVisible()) {
            await toggle.click();
            await page.waitForTimeout(1000); 
        }

        const menuEnlaces = page.locator('span:has-text("Enlaces de Pago")').first();
        await menuEnlaces.waitFor({ state: 'visible', timeout: 8000 });
        await menuEnlaces.click();
        await page.waitForTimeout(500);

        const subCrearEnlace = page.locator('span:has-text("Crear Enlace de Pago")').first();
        await subCrearEnlace.waitFor({ state: 'visible', timeout: 8000 });
        await subCrearEnlace.click();

        await page.waitForSelector('#country', { timeout: 15000 });
        await attachScreenshot('Formulario UI Listo');

        // =========================================================
        // 3. LLENADO DEL FORMULARIO MERCHANT (AR)
        // =========================================================
        console.log("➡️ Paso 3: Población dinámica del Formulario (Argentina, 1200.54, Mock True)");
        await page.selectOption('#country', 'AR');
        
        // Auto-hidratación de moneda
        const currencySelect = page.locator('#currency').first();
        expect(await currencySelect.inputValue()).toBe('ARS'); 

        // Rellenar datos
        await typeSafe('#amount', transactionAmount.toString());
        await typeSafe('#first_name', 'Sergio');
        await typeSafe('#last_name', 'MerchantTest');
        await typeSafe('#email', 'merchant_payin@test.com');
        
        // En algunos entornos el documento no es restrictivo para generar link, pero aseguramos.
        try {
            await page.selectOption('#document_type', 'CUIL').catch(() => null);
            await typeSafe('#document_number', '20275105792').catch(() => null);
        } catch (e) {}

        // Setear Mock. Existen checkboxes dependiendo de si es enable_mock o disable_mock env...
        const chkEnableMock = page.locator('#enable_mock');
        const chkDisableMock = page.locator('#disable_mock');
        // El usuario solicitó `mock, true`, forzaremos la habilitación si existe, y desabilitaremos disable_mock si existe.
        if (await chkEnableMock.count() > 0) await chkEnableMock.check().catch(()=>null);
        if (await chkDisableMock.count() > 0) await chkDisableMock.uncheck().catch(()=>null);

        await attachScreenshot('Formulario Completado y Validado');
        await page.locator('#save').click();

        // =========================================================
        // 4. AISLAR FILA DE LA GRILLA
        // =========================================================
        console.log("➡️ Paso 4: Transición a Grilla y Rastreo Fila...");
        await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => null);
        await page.waitForSelector('span[data-state="pending"]', { timeout: 15000 }); 

        const tableContent = await page.locator('table').innerText().catch(() => page.innerText('body'));
        expect(tableContent).toContain('1200.54');
        expect(tableContent).toContain('ARS');
        expect(tableContent).toContain('AR');

        // Evidencia puntual a la Row
        const firstTableRow = page.locator('tbody tr').first();
        if (allure && allure.attachment) {
            const buffer = await firstTableRow.screenshot().catch(()=>null);
            if (buffer) allure.attachment(`📸 Aislar Registro Grilla - Enlace PayIn`, buffer, "image/png");
        }

        // =========================================================
        // 5. VISITAR EL VOUCHER NATAL DE PAYPAGA (FRONT EXTERNO)
        // =========================================================
        console.log("➡️ Paso 5: Viajando al Checkout Público desde el UI Merchant..");
        const paymentUrlTag = page.locator('a[href*="/pl/"]').first();
        expect(await paymentUrlTag.isVisible()).toBe(true);

        const popupPromise = context.waitForEvent('page');
        await paymentUrlTag.click(); 
        const newTab = await popupPromise;

        await newTab.waitForLoadState('domcontentloaded');
        await newTab.waitForTimeout(4000); // Tiempo para el montaje React

        if (allure && allure.attachment) {
            const bp = await newTab.screenshot({ fullPage: true }).catch(()=>null);
            if (bp) allure.attachment(`📸 Checkout Voucher PayPaga (Public View)`, bp, "image/png");
        }

        const gatewayHTML = await newTab.innerText('body').catch(() => "");
        const wasMatched = gatewayHTML.includes('1200.54') && gatewayHTML.includes('ARS');
        
        expect(wasMatched).toBe(true); // ¡Si no aparece el precio o la moneda ARS estallara!
        await newTab.close();

        // =========================================================
        // 6. ADELANTAR ESTADO VIA V2 ADMIN APP (FAST ADMIN)
        // =========================================================
        console.log("➡️ Paso 6: Rescatando Transaction ID y despachando hacia Admin Portal V2");
        await page.bringToFront();
        
        // Transiciones UI
        const btnTransacciones = page.getByRole('link', { name: ' Transacciones ' }).first();
        await btnTransacciones.click({ force: true }).catch(()=>null);
        await page.waitForTimeout(1000);
        
        const btnEntradas = page.getByRole('link', { name: 'Transacciones de Entrada' }).first();
        await btnEntradas.click({ force: true }).catch(()=>null);

        await page.waitForTimeout(4000); // UI Rendering Tabla
        
        // UUID Regex Scanner 
        const generatedTxId = await page.evaluate(() => {
            const uuidRegex = /[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/;
            const elements = document.body.innerText.match(uuidRegex);
            return elements ? elements[0] : null;
        });

        if (!generatedTxId) {
            throw new Error("⚠️ FALLO FATAL: No se encontró un UUID en la tabla de Transacciones de Entrada luego de crear el enlace de pago.");
        } 

        console.log(`\n🔗 PayIn ARS Transaction ID: ${generatedTxId}`);
        if (allure && allure.attachment) allure.attachment('PayIn UUID Transaccion', generatedTxId, 'text/plain');
        
        // Magia: Nos desviaremos al Admin v2 con nuestro Helper hibridado
        await fastAdminAction(page, generatedTxId, 'pay-in', allure);

        // =========================================================
        // 7. CALCULO MATEMÁTICO DE SALDOS DE RETORNO Y AUDITORÍA
        // =========================================================
        console.log("➡️ Paso 7: Matemática Final");
        const finalBalances = await loginAndCaptureDashboard(page, allure, false, 'AR');
        console.log(`📈 SALDOS FINALES CAPTURADOS: ${JSON.stringify(finalBalances)}`);

        // Calculo de diferencias
        const opDiff = Math.abs(finalBalances.volume - initialBalances.volume);
        const feeDiff = Math.abs(finalBalances.fees - initialBalances.fees);
        const taxDiff = Math.abs(finalBalances.taxes - initialBalances.taxes);
        const netValue = opDiff - feeDiff - taxDiff;

        const mathAuditText = `
==================================================================
🧮 MERCHANT PAYIN IMPACT CALCULATION (AR)
==================================================================
Concept              | Details                     | Oper | Value
------------------------------------------------------------------
Initial General Bal  | Opening Balance (General)   | ARS  | ${initialBalances.general.toFixed(2)}
Merchant PayIn Amount| ${opDiff.toFixed(2)} In (-) ${feeDiff.toFixed(2)} F (-) ${taxDiff.toFixed(2)} T |  -   | ${netValue.toFixed(2)}
------------------------------------------------------------------
Current General Bal  | Total current balance in UI | ARS  | ${finalBalances.general.toFixed(2)}
==================================================================
Concept              | Details                     | Oper | Total
------------------------------------------------------------------
Fees                 | ${Math.abs(initialBalances.fees).toFixed(2).padEnd(8)} | (+) ${feeDiff.toFixed(2).padEnd(6)} | ARS  | ${Math.abs(finalBalances.fees).toFixed(2)}
Taxes                | ${Math.abs(initialBalances.taxes).toFixed(2).padEnd(8)} | (+) ${taxDiff.toFixed(2).padEnd(6)} | ARS  | ${Math.abs(finalBalances.taxes).toFixed(2)}
==================================================================
`;
        console.log(mathAuditText);

        // Aserciones Numéricas. General + Volume debe incrementar.
        expect(finalBalances.general).toBeGreaterThan(initialBalances.general);
        expect(finalBalances.volume).toBeGreaterThan(initialBalances.volume);
        
        // Fees y Taxes normalmente transicionan. (Asegurando diferencia por el ingreso)
        expect(finalBalances.fees).not.toBe(initialBalances.fees);
        expect(finalBalances.taxes).not.toBe(initialBalances.taxes);
        
        if (allure && allure.attachment) {
            allure.attachment('🧮 Auditoría Matemática UI ARS', mathAuditText, 'text/plain');
            await allure.attachment(`Comparativa PayIn Merchant UI - ARS`, JSON.stringify({ 
                SALDO_INICIAL: initialBalances, 
                COMPROBANTE_GENERADO: transactionAmount,
                SALDO_MODIFICADO: finalBalances 
            }, null, 2), "application/json");
        }
        console.log("✅ FLUJO OMNICHANNEL ARS (PAYIN MERCHANT) CULMINADO EXITOSAMENTE.");
    });
});
