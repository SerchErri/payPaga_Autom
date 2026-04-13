const allure = require('allure-js-commons');
const { chromium } = require('playwright');

const fNames = ['Juan', 'Maria', 'Carlos', 'Ana', 'Sergio', 'Laura', 'Diego', 'Lucia'];
const lNames = ['Doe', 'Perez', 'Gomez', 'Lopez', 'Silva', 'Garcia', 'Martinez', 'Rodriguez'];
const rE = (arr) => arr[Math.floor(Math.random() * arr.length)];

const faker = {
    internet: { email: () => `test${Date.now()}@paypaga.com` },
    person: { firstName: () => rE(fNames), lastName: () => rE(lNames) },
    string: { 
        numeric: (len) => Array.from({length: len}, () => Math.floor(Math.random() * 10)).join(''),
        reference: () => `VOU-${Array.from({length:3},()=>String.fromCharCode(65+Math.floor(Math.random()*26))).join('')}${Math.floor(10+Math.random()*90)}`
    },
    lorem: { word: () => rE(['Factura', 'Pago', 'Servicio', 'Voucher', 'Auto']) }
};
const envConfig = require('../../utils/envConfig');

jest.setTimeout(2400000);

const casesData = [
  { country: 'AR', methods: ['cvu'] },
  { country: 'BR', methods: ['pix'] },
  // Desactivado CL: 'khipu'
  { country: 'CL', methods: ['bank_transfer'] },
  // Desactivados: 'dale', 'daviplatanative', 'movii', 'nequi', 'rappipay', 'transfiya'
  { country: 'CO', methods: ['efecty', 'gana', 'pse', 'puntored', 'superpagos', 'sured', 'susuerte', 'wu'] },
  // Desactivados EC: 'pichincha'
  { country: 'EC', methods: ['bemovil', 'deuna', 'minegocioefectivo', 'omniswitch', 'rapiactivo', 'bank_transfer', 'wu'] },
  { country: 'SV', methods: ['bancoagricola', 'cuscatlan', 'puntoxpresssv'] },
  { country: 'GT', methods: ['bam', 'bam_transferencia', 'bi'] },
  { country: 'MX', methods: ['paycash', 'spei'] },
  { country: 'PE', methods: ['bbva', 'bcp', 'bcp_efectivo', 'cellpower', 'globokas', 'plin', 'ligoqrinterbilletera', 'yape'] }
];

const flatCases = [];
casesData.forEach(c => {
    c.methods.forEach(m => {
        flatCases.push({ country: c.country, method: m });
    });
});

describe('E2E - Creación de Enlaces de Pago y Validación de Vouchers', () => {
    let browser;
    let context;
    let page;

    beforeAll(async () => {
        try {
            browser = await chromium.launch({ headless: true });
            context = await browser.newContext({ locale: 'es-ES', colorScheme: 'dark' });
            page = await context.newPage();
            page.setDefaultTimeout(30000);

            let baseURL = envConfig.BASE_URL || 'https://api.v2.dev.paypaga.com';
            const domainRoot = baseURL.replace("api", "admin").replace("admin", "merchant"); 
            let loginUrl = `${domainRoot}/login`; 
            if(!loginUrl.includes('merchant')) loginUrl = envConfig.FRONTEND_URL || "https://merchant.v2.dev.paypaga.com/login";

            console.log("Iniciando sesión en:", loginUrl);
            await page.goto(loginUrl, { waitUntil: 'networkidle' });
            
            await page.waitForSelector('input[type="email"]', { timeout: 15000 }).catch(()=>null);
            
            const email = envConfig.FRONTEND_PARAMS ? envConfig.FRONTEND_PARAMS.email : 'automation@paypaga.com';
            const pwd = envConfig.FRONTEND_PARAMS ? envConfig.FRONTEND_PARAMS.password : 'P@assword.';
            
            await page.getByRole('textbox', { name: /Email/i }).fill(email);
            // El selector original del helper es 'Contraseña', pero para ser agnóstico:
            await page.locator('input[type="password"]').fill(pwd);
            await page.waitForTimeout(500); // Trigger events via brief pause
            await page.keyboard.press('Tab'); // Trigger blur events which often validate the form
            
            const btnLogin = page.locator('button[type="submit"]').first();
            await btnLogin.waitFor({ state: 'visible', timeout: 5000 });
            await btnLogin.click({ force: true });
            
            await page.waitForTimeout(5000);
            
            console.log("URL post-login: " + page.url());
            if (page.url().includes('login')) {
                console.error("ALERTA: El login parece haber fallado. Seguimos en " + page.url());
            }
        } catch (e) {
            console.error("Fallo levantando Playwright y haciendo login", e);
        }
    });

    afterAll(async () => {
        if (browser) await browser.close();
    });

    // Iteramos por cada país y método de pago
    test.each(flatCases)('Validar Voucher para País: $country | Método: $method', async ({ country, method }) => {
        console.log(`\n▶ INICIANDO TEST: País [${country}] Métod [${method}]`);
        
        let baseURL = envConfig.BASE_URL || 'https://api.v2.dev.paypaga.com';
        const domainRoot = baseURL.replace("api", "admin").replace("admin", "merchant"); 
        
        // Vamos directo a la interfaz del dashboard, y clickeamos el enlace de pago
        await page.goto(`${domainRoot}/`).catch(()=>null);
        await page.waitForTimeout(2000);

        // El servidor devuelve 404 crudo si navegamos por URL directa, es necesario usar el enrutador SPA del frontend.
        console.log(`🌍 Navegando por UI desde el Dashboard...`);
        await page.goto(`${domainRoot}/`, { waitUntil: 'networkidle' }).catch(()=>null);
        await page.waitForTimeout(3000);

        try {
            // 1. Expandir el acordeón principal "Enlaces de Pago" (aseguramos match exacto o usando index)
            const mainLink = page.locator('span').filter({ hasText: /^Enlaces de Pago$/i }).first();
            await mainLink.click({ force: true }).catch(()=>null);
            await page.waitForTimeout(1000);

            // 2. Click en el sub-item "Crear Enlace de Pago"
            const subLink = page.locator('span').filter({ hasText: /^Crear Enlace de Pago$/i }).first();
            await subLink.click({ force: true });
            
        } catch (e) {
            console.log("Fallo al interactuar con el sidebar menu, posiblemente distinto en mobile view.");
        }
        await page.waitForTimeout(3000);

        // SELECCIÓN DE PAÍS
        const selectCountry = page.locator('select#country');
        try {
            // Buscamos 'attached' en lugar de 'visible' por si usan un select oculto con UI custom
            await selectCountry.waitFor({state: 'attached', timeout: 10000});
        } catch(e) {
            console.error("Timeout buscando select#country. URL final atrapada en:", page.url());
            
            // VOLCAR EL DOM PARA DEPURACIÓN
            const fs = require('fs');
            fs.writeFileSync('page_dump.html', await page.content());
            console.log("DOM volcado en page_dump.html");

            // TOMAR SCREENSHOT EXPLÍCITO DEL ERROR PARA ALLURE
            if (allure && allure.attachment) {
                const ss = await page.screenshot();
                await allure.attachment("Error_DOM_Dump", ss, "image/png");
            }
            throw e;
        }
        await selectCountry.selectOption(country, { force: true }).catch(() => null);
        await selectCountry.evaluate((node, val) => { 
            node.value = val; 
            node.dispatchEvent(new Event('change', { bubbles: true }));
        }, country).catch(() => null);
        
        await page.waitForTimeout(1000);

        // --- PAYLOADS REGIONALES ESTRICTOS PARA FRONTEND ---
        let cData = {
            doc: faker.string.numeric(8),
            firstName: `Auto-${faker.lorem.word().replace(/[^a-zA-Z]/g, '')}`,
            lastName: rE(lNames),
            phone: '3001234567',
            amount: '150.50',
            currency: null,
            bankCode: null,
            docType: null,
            email: faker.internet.email(),
            confCode: null
        };

        if (country === 'AR') { 
            cData.doc = '20275105792'; cData.firstName = 'Sergio Daniel ' + rE(fNames); cData.lastName = 'Gomez'; 
        }
        if (country === 'BR') { 
            cData.doc = '21222956608'; cData.firstName = 'Thiago ' + rE(fNames); cData.lastName = 'Dos Santos'; 
        }
        if (country === 'CL') { 
            cData.doc = '15.541.341-K'; cData.email = 'sergio.gomez@example.cl'; cData.bankCode = 'santander'; 
        }
        if (country === 'CO') { 
            cData.phone = '3159876543'; // Nequi fallback o general
            if (method.includes('pse') || method.includes('PSE')) {
                cData.firstName = 'Mariana ' + rE(fNames); cData.lastName = 'Pajón';
                cData.docType = 'CC'; cData.doc = '52345678'; cData.bankCode = '1007';
                cData.email = 'mariana.test@pago.com.co'; cData.phone = '3005551234';
            }
        }
        if (country === 'EC') {
            cData.firstName = 'Luis ' + rE(fNames); cData.lastName = 'Antonio Valencia'; 
            cData.docType = 'CI'; cData.doc = '1710034065'; cData.email = 'l.valencia@test.com';
        }
        if (country === 'GT') { 
            cData.firstName = 'Miguel ' + rE(fNames); cData.lastName = 'Asturias'; 
            cData.docType = 'NIT'; cData.doc = '4567891-2'; cData.currency = 'GTQ'; cData.email = 'm.asturias@test.com.gt'; cData.amount = '150'; 
        }
        if (country === 'SV') { 
            cData.firstName = 'Ernesto ' + rE(fNames); cData.lastName = 'Rivas'; 
            cData.docType = 'DUI'; cData.doc = '12345678-9'; cData.currency = 'USD'; cData.email = 'e.rivas@test.com.sv'; cData.amount = '15'; 
        }
        if (country === 'MX') {
            cData.firstName = 'Cuauhtémoc ' + rE(fNames); cData.lastName = 'Blanco'; 
            cData.currency = 'MXN'; cData.amount = '1500.00';
            if (method.includes('spei') || method.includes('SPEI')) {
                cData.doc = 'GOSD900315HDFRRN01';
            } else {
                cData.doc = ''; // Para paycash y otros, evitamos inyectar documento incorrecto
            }
        }
        if (country === 'PE') {
            cData.currency = 'PEN'; cData.amount = '50.00'; cData.phone = '981234567'; cData.confCode = '654321';
        }

        // DESTRABAR DESPLEGABLES EN CASCADA: Seleccionar moneda si existe para que Method se pueble
        if (cData.currency) {
            const currencySel = page.locator('select[name*="currency"], select[name*="moneda"], select#currency').first();
            await currencySel.waitFor({ state: 'attached', timeout: 3000 }).catch(()=>null);
            if (await currencySel.isVisible()) {
                await currencySel.selectOption(cData.currency, { force: true }).catch(()=>null);
                await page.waitForTimeout(1000); 
            }
        }

        // SELECCIÓN DE MÉTODO
        const selectMethod = page.locator('select#payment_method');
        await selectMethod.waitFor({state: 'attached', timeout: 5000}).catch(()=>null);
        await selectMethod.selectOption(method, { force: true }).catch(()=>null);
        await selectMethod.evaluate((node, val) => { 
            node.value = val; 
            node.dispatchEvent(new Event('change', { bubbles: true }));
        }, method).catch(() => null);

        await page.waitForTimeout(2000); // Dar tiempo al render de los campos dinámicos
        
        const trackFinalName = cData.firstName;

        // RELLENAR EL RESTO DE CAMPOS DEL FORMULARIO
        const inputs = await page.locator('form input:visible').all();
        for (const input of inputs) {
            const name = (await input.getAttribute('name')) || '';
            const type = (await input.getAttribute('type')) || '';
            const id = (await input.getAttribute('id')) || '';
            const rawval = await input.inputValue();
            
            // si ya tiene valor y no está vacío, no lo sobreescribimos necesariamente, 
            // a menos que queramos asegurar data.
            // Ignorar checkboxs, radios o subit.
            if (['checkbox', 'radio', 'submit', 'button', 'hidden'].includes(type)) continue;

            const n = (name + '_' + id).toLowerCase();

            if (type === 'email' || n.includes('email')) {
                await input.fill(cData.email);
            } else if (n.includes('first_name') || n.includes('name')) {
                await input.fill(cData.firstName);
            } else if (n.includes('last_name')) {
                await input.fill(cData.lastName);
            } else if (n.includes('document') || n.includes('dni') || n.includes('rut') || n.includes('nit') || n.includes('cpf') || n.includes('cui') || n.includes('identifica')) {
                await input.fill(cData.doc);
            } else if (type === 'number' || n.includes('amount') || n.includes('monto')) {
                await input.fill(String(cData.amount));
            } else if (n.includes('phone') || n.includes('celular') || n.includes('tel')) {
                await input.fill(cData.phone);
            } else if (n.includes('code') || n.includes('conformation')) { // Conformation code
                if (cData.confCode) await input.fill(cData.confCode);
                else await input.fill('123456');
            } else if (type === 'text' && (n.includes('ref') || n.includes('id') || n.includes('concept'))) {
                const rnd = Math.random().toString(36).substring(2, 8).toUpperCase();
                await input.fill(`VOU-${rnd}`);
            } else if (type === 'text' && !n.includes('address') && !n.includes('direccion')) {
                // Sanitizamos el texto genérico para cumplir patrones estrictos `^[A-Za-z0-9-_]+$` que puede tener el Front
                const safeWord = faker.lorem.word().replace(/[^a-zA-Z0-9-_]/g, '');
                await input.fill(`${safeWord}${Math.floor(Math.random()*1000)}`);
            } else if (type === 'text' && (n.includes('address') || n.includes('direccion'))) {
                await input.fill('Calle de pruebas #123 Autoguiadas');
            }
            await page.waitForTimeout(300); // Pequeña pausa simulando humanos
        }

        // Llenar selectores dinámicos extra (si el documento_type dropdown es visible por ej)
        const selects = await page.locator('form select:visible').all();
        for (const sel of selects) {
            const id = await sel.getAttribute('id') || '';
            const name = await sel.getAttribute('name') || '';
            if (id === 'country' || name === 'country' || id === 'payment_method' || name === 'payment_method') continue;

            const n = (name + '_' + id).toLowerCase();
            let optionForced = false;

            if ((n.includes('bank') || n.includes('banco') || n.includes('institution')) && cData.bankCode) {
                await sel.selectOption(cData.bankCode, { force: true }).catch(()=>null);
                optionForced = true;
            }
            else if ((n.includes('currency') || n.includes('moneda')) && cData.currency) {
                await sel.selectOption(cData.currency, { force: true }).catch(()=>null);
                optionForced = true;
            }
            else if ((n.includes('doc') || n.includes('tipo')) && cData.docType) {
                await sel.selectOption(cData.docType, { force: true }).catch(()=>null);
                optionForced = true;
            }

            if (!optionForced) {
                const options = await sel.locator('option').all();
                if(options.length > 1) {
                    // elegir el 2do, porque el 1ro suele ser "Selecciona una opción"
                    const val = await options[1].getAttribute('value');
                    await sel.selectOption(val);
                }
            }
        }

        // DESACTIVAR MOCK
        const disableMock = page.locator('#disable_mock');
        if (await disableMock.isVisible()) {
            await disableMock.check();
        }

        // CAPTURA 1: FORMULARIO ANTES DE CONFIRMAR PAGO
        if (allure && allure.attachment) {
            const ssForm = await page.screenshot({ fullPage: true });
            await allure.attachment(`📸 1. EVIDENCIA FORMULARIO - [${country}] ${method.toUpperCase()}`, ssForm, "image/png");
        }

        // CREAR ENLACE
        const saveBtn = page.locator('button#save').or(page.locator('button:has-text("Crear Enlace de Pago")')).first();
        await saveBtn.click({ force: true });

        console.log(`⏳ Esperando redirección a la grilla y procesando...`);
        await page.waitForTimeout(6000); // Dar margen a la creación de API y redirección

        // Asegurarnos de que no falló la validación del formulario
        if (page.url().includes('create')) {
            const fs = require('fs');
            fs.writeFileSync(`gt_error_dump_${method}.html`, await page.content());
            
            if (allure && allure.attachment) {
                const errSS = await page.screenshot({ fullPage: true });
                await allure.attachment(`🔴 Error: Validación estricta o payload fallido - [${country}]`, errSS, "image/png");
            }
            throw new Error(`Prueba abortada: El formulario rechazó la data para el país ${country}. Revisa el error de validación en UI en el reporte.`);
        }

        // PASO 2: UBICAR EN LA GRILLA
        // Buscar las filas en la tabla
        const listRows = page.locator('tbody tr, .MuiTableRow-root, .MuiDataGrid-row');
        let exactRow = listRows.filter({ hasText: new RegExp(trackFinalName, "i") }).first();
        
        try {
            // Intentar cazar la fila por nombre primero
            try {
                await exactRow.waitFor({ state: 'attached', timeout: 6000 });
                console.log(`✅ Fila coincidente encontrada para: ${trackFinalName}`);
            } catch {
                exactRow = listRows.first();
                await exactRow.waitFor({ state: 'attached', timeout: 10000 });
                console.log(`⚠️ Fila exacta no vista (ej: método sin Nombre en UI), tomando la más reciente en Top`);
            }

            // El comprobante es el primer enlace `<a>` que va hacia un payment link con ruta `/pl/`
            const actionTarget = exactRow.locator('a[href*="/pl/"]');
            await actionTarget.first().waitFor({ state: 'visible', timeout: 5000 });
            
            // CAPTURA 2: EVIDENCIA GRILLA (SOLO EL PAYMENT LINK)
            if (allure && allure.attachment) {
                const ssLinkOnly = await actionTarget.first().screenshot();
                await allure.attachment(`📸 2. LINK EN GRILLA - [${country}] ${method}`, ssLinkOnly, "image/png");
            }

            // PASO 3: ABRIR EL VOUCHER Y CAPTURARLO
            const [newPage] = await Promise.all([
                context.waitForEvent('page', { timeout: 6000 }).catch(() => null),
                actionTarget.first().click({ force: true })
            ]);

            // Determinar contexto donde recayó el voucher
            let voucherPage = newPage || page;
            await voucherPage.waitForLoadState('networkidle').catch(()=>null);
            await voucherPage.waitForTimeout(5000); 
            
            console.log(`📍 URL Final del Voucher: ${voucherPage.url()}`);

            // CAPTURA 3: VOUCHER FINAL FULL-PAGE
            if (allure && allure.attachment) {
                const ssVoucher = await voucherPage.screenshot({ fullPage: true });
                await allure.attachment(`📸 3. EVIDENCIA VOUCHER FINAL - [${country}] ${method}`, ssVoucher, "image/png");
            }
            
            if (newPage) await newPage.close();

        } catch (err) {
            console.log(`❌ Falló la cacería de grilla para '${trackFinalName}'. ERROR:`, err.message);
            if (allure && allure.attachment) {
                const errSS = await page.screenshot({ fullPage: true });
                await allure.attachment(`🔴 Rescate: Búsqueda de Grilla Fallida - [${country}]`, errSS, "image/png");
            }
            throw new Error(`Prueba cortada en la grilla para ${country}. El voucher nunca se abrió o falló la creación: ${err.message}`);
        }
        
        expect(page.url()).toBeTruthy();
    });
});
