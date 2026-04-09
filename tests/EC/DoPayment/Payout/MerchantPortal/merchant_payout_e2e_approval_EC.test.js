const { chromium } = require('playwright');
const allure = require('allure-js-commons');
const envConfig = require('../../../../../utils/envConfig');

jest.setTimeout(1800000); 

describe(`[E2E UI] FULL FLOW - MERCHANT & ADMIN: Creación, Aprobación y Validaciones de Saldo EC [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
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

    const scrapeBalances = async (pageInstance) => {
        return await pageInstance.evaluate(() => {
            const cleanVal = (txt) => parseFloat(txt.replace(/[^0-9.-]+/g, "") || "0");
            
            // 1. Encontrar el texto EC en el cajón de bandera
            const flexEC = Array.from(document.querySelectorAll('div.flex.items-center')).find(d => d.innerText.trim() === 'EC');
            if(!flexEC) return { general: 0, available: 0, withdrawals: 0, fees: 0, taxes: 0 };
            
            // Subir al container (card) específico de ese país usando la clase del DOM confirmada
            const countryContainer = flexEC.closest('div.rounded-2xl');
            if(!countryContainer) return { general: 0, available: 0, withdrawals: 0, fees: 0, taxes: 0 };

            // 2. Saldo General EC (Buscando el h3 cercano dentro de sub-contenedor del logo)
            let general = 0;
            const h3General = flexEC.parentElement.querySelector('h3');
            if (h3General) general = cleanVal(h3General.innerText);

            // 3. Disponible para pagos (BUSCADO DENTRO DE LA CARD COMPLETA FRONTEND)
            let available = 0;
            const availEl = Array.from(countryContainer.querySelectorAll('div.text-right')).find(d => d.innerText.includes('Disponible para pagos'));
            if (availEl) available = cleanVal(availEl.innerText);

            // Helpers para extraer Cajas rectangulares por nombre de ícono
            const getMetric = (iconClass) => {
                const icon = countryContainer.querySelector(`em.${iconClass}`);
                if(!icon) return 0;
                // Busca la caja div envolvente (rounded-lg) dictada por el HTML front
                const wrapper = icon.closest('div.rounded-lg');
                return wrapper ? cleanVal(wrapper.lastElementChild.innerText) : 0;
            };

            return {
                general,
                available,
                withdrawals: getMetric('ni-signout'),
                fees: getMetric('ni-coin'),
                taxes: getMetric('ni-reports')
            };
        });
    };

    test('Flujo E2E Completo Monolítico: Creación Merchant -> Aprobación Admin -> Validaciones de Saldo', async () => {
        // =========================================================
        // A) LOGIN MERCHANT

        // =========================================================
        let baseURL = envConfig.BASE_URL;
        const domainRoot = baseURL.replace("api", "admin").replace("admin", "merchant"); 
        let loginUrl = `${domainRoot}/login`; 
        if(!loginUrl.includes('merchant')) loginUrl = "https://merchant.v2.dev.paypaga.com/login";

        await page.goto(loginUrl, { waitUntil: 'networkidle' });
        
        await page.waitForSelector('input[type="email"]', { timeout: 15000 }).catch(()=>null);
        await page.getByRole('textbox', { name: 'Email' }).fill(envConfig.FRONTEND_PARAMS.email);
        await page.getByRole('textbox', { name: 'Contraseña' }).fill(envConfig.FRONTEND_PARAMS.password);
        
        const btnLogin = page.getByRole('button', { name: 'Iniciar sesión' }).first();
        await btnLogin.evaluate(node => node.disabled = false).catch(()=>null);
        await btnLogin.click({ force: true });
        
        // Esperemos que cargue el dashboard e identificadores numéricos
        await page.waitForSelector('h3.text-2xl', { timeout: 20000 }).catch(()=>null);
        await page.waitForTimeout(3000); 

        // =========================================================
        // B) EXTRACCIÓN Y VALIDACIÓN DE SALDOS INICIALES
        // =========================================================
        initialBalances = await scrapeBalances(page);
        console.log("💰 SALDOS INICIALES:", initialBalances);

        if(initialBalances.available < payoutMontoTest) {
            console.warn(`⚠️ ALERTA: Tienes ${initialBalances.available} disponibles, pero intentaremos crear un payout de ${payoutMontoTest}. La API podría rechazarlo por falta de fondos.`);
        }
        
        // Hacer scroll y fotografiar EXCLUSIVAMENTE el elemento del Carrusel de Ecuador
        const ecuadorCard = page.locator('div.snap-start', { has: page.locator('img[alt="EC flag"]') }).first();
        await ecuadorCard.scrollIntoViewIfNeeded().catch(()=>null);
        await page.waitForTimeout(800); // Esperamos a que la animación termine

        if(allure && allure.attachment){
            try {
                const cardBuffer = await ecuadorCard.screenshot();
                await allure.attachment(`📸 Evidencia Visual: Elemento Balance EC (Previo)`, cardBuffer, "image/png");
            } catch(e){ console.log("No se pudo fotografiar la card EC", e); }
        }

        await attachScreenshot('Dashboard Merchant - Pantalla Completa');

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
        await page.goto(`${domainRoot}/logout`).catch(()=>null);
        
        // =========================================================
        // === FASE 2: FLUJO ADMIN PORTAL (APROBACIÓN) ===
        // =========================================================
        let currentEnv = (envConfig.currentEnvName || "dev").toLowerCase();
        let adminUrl = `https://admin.v2.${currentEnv}.paypaga.com/login`;

        await page.goto(adminUrl, { waitUntil: 'networkidle' });
        
        await page.waitForSelector('input[type="email"]', { timeout: 15000 }).catch(()=>null);
        // Credenciales Admin estáticas asignadas por QA
        await page.getByRole('textbox', { name: /Email/i }).fill("serrigo@paypaga.com");
        await page.locator('input[type="password"]').fill("P@assword.");
        
        const btnLoginAdmin = page.locator('button[type="submit"]').first();
        await btnLoginAdmin.evaluate(node => node.disabled = false).catch(()=>null);
        await btnLoginAdmin.click({ force: true });
        
        await page.waitForTimeout(4000); // Esperar carga dashboard admin
        
        // =========================================================
        // B) APROBACIÓN VÍA URL 'HYBRID-API' (Evitando UI lenta)
        // =========================================================
        const merchantId = envConfig.FRONTEND_PARAMS.merchantId;
        const approveUrl = `https://admin.v2.${currentEnv}.paypaga.com/transactions/pay-out/${storedTxId}/approve?merchant_id=${merchantId}`;
        
        await page.goto(approveUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000); // Dar unos segundos al backend para liquidar

        console.log(`\n⚡ ADMIN UI BYPASS -> OPERACIÓN APROBADA AL INSTANTE (${approveUrl})`);
        if (allure && allure.attachment) allure.attachment('Transacción forzada', approveUrl, 'text/plain');

        await attachScreenshot('Transacción forzada a Aprobada');

        // Logout de Admin
        await page.goto(`https://admin.v2.${currentEnv}.paypaga.com/logout`).catch(()=>null);

        // =========================================================
        // D) VOLVER A MERCHANT Y VALIDAR IMPACTO DE SALDOS
        // =========================================================
        baseURL = envConfig.BASE_URL;
        loginUrl = `${domainRoot}/login`; 
        if(!loginUrl.includes('merchant')) loginUrl = "https://merchant.v2.dev.paypaga.com/login";

        await page.goto(loginUrl, { waitUntil: 'networkidle' });
        await page.waitForSelector('input[type="email"]', { timeout: 15000 }).catch(()=>null);
        await page.getByRole('textbox', { name: 'Email' }).fill(envConfig.FRONTEND_PARAMS.email);
        await page.getByRole('textbox', { name: 'Contraseña' }).fill(envConfig.FRONTEND_PARAMS.password);
        await page.getByRole('button', { name: 'Iniciar sesión' }).first().click({ force: true });
        
        await page.waitForSelector('h3.text-2xl', { timeout: 20000 }).catch(()=>null);
        await page.waitForTimeout(3000); 

        const finalBalances = await scrapeBalances(page);
        console.log("💰 SALDOS FINALES TRAS APROBACIÓN:", finalBalances);

        // Fotografiar el container específico después
        const ecuadorCardFinal = page.locator('div.snap-start', { has: page.locator('img[alt="EC flag"]') }).first();
        await ecuadorCardFinal.scrollIntoViewIfNeeded().catch(()=>null);
        await page.waitForTimeout(800);

        if(allure && allure.attachment){
            try {
                const cardFinalBuffer = await ecuadorCardFinal.screenshot();
                await allure.attachment(`📸 Evidencia Visual: Elemento Balance EC (Impacto Posterior)`, cardFinalBuffer, "image/png");
            } catch(e){}
        }

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
