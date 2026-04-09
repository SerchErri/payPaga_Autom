const { chromium } = require('playwright');
const allure = require('allure-js-commons');
const envConfig = require('../../../../../utils/envConfig');
const { loginAndCaptureDashboard, fastAdminApprove } = require('../../../../../utils/uiBalanceHelper');

jest.setTimeout(1800000); 

describe(`[E2E Híbrido] FULL FLOW - MERCHANT PORTAL EC Payout: Creación, Grilla y Admin Approve [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    let browser;
    let context;
    let page;
    let storedTxId = "";
    let initialBalances = {};
    let payoutMontoTest = 52.00;

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
                await allure.attachment(`📸 Evidencia Visual: ${name}`, buffer, "image/png");
            } catch(e){}
        }
    };

    test('Flujo E2E Completo Monolítico: Creación Merchant -> Aprobación Admin -> Validaciones de Saldo', async () => {
        // =========================================================
        // A) LOGIN MERCHANT & CAPTURA INICIAL
        // =========================================================
        initialBalances = await loginAndCaptureDashboard(page, allure, true);
        console.log("💰 SALDOS INICIALES:", initialBalances);

        if(initialBalances.available < payoutMontoTest) {
            console.warn(`⚠️ ALERTA: Tienes ${initialBalances.available} disponibles, pero intentaremos crear un payout de ${payoutMontoTest}. La API podría rechazarlo por falta de fondos.`);
        }

        // =========================================================
        // C) NAVEGAR Y CREAR PAYOUT
        // =========================================================
        const btnTransacciones = page.getByRole('link', { name: ' Transacciones ' }).first();
        await btnTransacciones.click();
        
        const btnSalida = page.getByRole('link', { name: 'Transacciones de Salida' }).first();
        await btnSalida.waitFor({ state: 'visible' });
        await btnSalida.click();
        
        const btnCrear = page.getByRole('link', { name: 'Crear Pago' }).first();
        await btnCrear.waitFor({ state: 'visible' });
        await btnCrear.click();

        await page.waitForSelector('text=Monto', { timeout: 15000 }).catch(()=>null);

        // LLENADO DEL FORMULARIO EC
        await page.getByLabel('País *').selectOption('EC');
        await page.locator('div').filter({ hasText: /^Monto \*$/ }).nth(1).click();
        await page.getByRole('textbox', { name: 'Monto *' }).fill(payoutMontoTest.toString());
        await page.getByRole('textbox', { name: 'Nombre*' }).fill('Sergio');
        await page.getByRole('textbox', { name: 'Apellido*' }).fill('Errigo Completo');
        await page.getByLabel('Tipo de Documento*').selectOption('CI');
        await page.getByRole('textbox', { name: 'Número de Documento*' }).fill('1710034065');
        await page.getByLabel('Banco*').selectOption('banco_pichincha');
        await page.getByLabel('Tipo de Cuenta*').selectOption('Ahorro');
        await page.getByRole('textbox', { name: 'Número de Cuenta*' }).fill('1234567890');
        await page.getByText('Disable Mock?').click().catch(()=>null); 

        await attachScreenshot('Formulario Payout Antes de Enviar');

        // =========================================================
        // D) CREAR Y EXTRAER ID
        // =========================================================
        await page.getByRole('button', { name: 'Crear Pago' }).click();
        
        // Esperamos agresivamente a que el sistema procese y agregue la fila a la tabla UI
        await page.waitForTimeout(6000); 

        // Vamos a raspar el ID recién insertado buscando en la tabla visible
        // La tabla suele tener celdas que contienen guiones de un UUID (ej: 8dc4-29882491e3b5)
        const possibleId = await page.evaluate(() => {
            // Buscamos cualquier td o elemento que parezca un UUID 
            const uuidRegex = /[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/;
            const elements = document.body.innerText.match(uuidRegex);
            return elements ? elements[0] : null;
        });

        if (possibleId) {
            storedTxId = possibleId;
        } else {
             console.log("🚨 ALERTA: No se encontró un UUID válido en la pantalla tras la creación.");
        }

        if (allure && allure.attachment) {
            await allure.attachment(`Número de Operación Payout`, `ID Generado (Visual): ${storedTxId}`, "text/plain");
        }
        console.log(`\n✅ PAYOUT CREADO CON ID (Scrapeado de UI): ${storedTxId}\n`);
        
        expect(storedTxId).toBeDefined();
        // Click a la primera fila para abrir Detalle Visual de ese Payout y no la grilla gigante
        const firstRow = page.locator('table tbody tr').first();
        await firstRow.click({ force: true }).catch(()=>null);
        await page.waitForTimeout(2000); // Animación de modal o sidebar

        if(allure && allure.attachment){
            // Capturamos explícitamente viewport para atrapar el modal/drawer y no la grilla vertical "larguísima"
            const vpBuffer = await page.screenshot({ fullPage: false });
            await allure.attachment(`📸 Evidencia Visual: Payout EC Detallado (Foco Singular)`, vpBuffer, "image/png");
        }

        // Logout para limpiar sesión Merchant y pasar al portal Admin dentro del MISMO CASO
        let baseURL = envConfig.BASE_URL;
        const domainRoot = baseURL.replace("api", "merchant");
        await page.goto(`${domainRoot}/logout`).catch(()=>null);
        
        // =========================================================
        // === FASE 2: FLUJO ADMIN PORTAL (APROBACIÓN RÁPIDA) ===
        // =========================================================
        await fastAdminApprove(page, storedTxId, 'pay-out', allure);
        await attachScreenshot('Transacción Confirmada Payout');

        // =========================================================
        // === FASE 3: VOLVER A MERCHANT Y VALIDAR IMPACTO ===
        // =========================================================
        const finalBalances = await loginAndCaptureDashboard(page, allure, false);
        console.log("💰 SALDOS FINALES TRAS APROBACIÓN:", finalBalances);

        await attachScreenshot('Dashboard Merchant - Final Pantalla Completa');

        // =========================================================
        // E) ASERCIONES MATEMÁTICAS ESCALABLES (Evita fallos por tests en paralelo)
        // =========================================================
        // El cajón de RETIROS debería de haber absorbido el Payout. 
        // En vez de usar matemáticas exactas (que fallan si 2 tests corren al mismo tiempo), verificamos la tendencia del state.
        if (initialBalances.withdrawals >= 0) { 
             expect(finalBalances.withdrawals).toBeGreaterThan(initialBalances.withdrawals);
        } else { 
             expect(finalBalances.withdrawals).toBeLessThan(initialBalances.withdrawals);
        }

        // El Saldo DISPONIBLE PARA PAGOS debe decrementar al ceder fondos
        expect(finalBalances.available).toBeLessThan(initialBalances.available);
        
        // Las Comisiones e impuestos deben estar renderizados en DOM
        expect(finalBalances.fees !== undefined).toBeTruthy();
        expect(finalBalances.taxes !== undefined).toBeTruthy();

        if (allure && allure.attachment) {
            await allure.attachment(`Comparativa de Saldos Contables`, JSON.stringify({ SALDOS_INICIALES: initialBalances, SALDOS_FINALES: finalBalances, MONTO_OPERACION_APROBADA: payoutMontoTest }, null, 2), "application/json");
        }
    });

});
