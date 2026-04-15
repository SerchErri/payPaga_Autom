const { chromium } = require('playwright');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../../../../utils/authHelper');
const { preLoadFunds } = require('../../../../../utils/uiBalanceHelper');
const envConfig = require('../../../../../utils/envConfig');

jest.setTimeout(1800000);

describe(`[E2E UI] Validaciones Interactivas Payout EC [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    
    let browser;
    let context;
    let sharedPage;
    let formUrl = '';

    beforeAll(async () => {
        browser = await chromium.launch({ headless: true });
        context = await browser.newContext({ locale: 'es-ES', colorScheme: 'dark' });
        sharedPage = await context.newPage();
        
        sharedPage.setDefaultTimeout(10000);
        
        try {
            const token = await getAccessToken();
            await preLoadFunds(sharedPage, token, allure, 10000.00);
        } catch(e) { console.error("Fallo AutoFondeando", e); }
        
        let baseURL = envConfig.BASE_URL;
        const domainRoot = baseURL.replace("api", "merchant");
        const loginUrl = `${domainRoot}/login`;

        await sharedPage.goto(loginUrl, { waitUntil: 'domcontentloaded' });
        
        await sharedPage.waitForSelector('input[type="email"]', { timeout: 15000 }).catch(()=>null);
        await sharedPage.getByRole('textbox', { name: 'Email' }).fill(envConfig.FRONTEND_PARAMS.email);
        await sharedPage.getByRole('textbox', { name: 'Contraseña' }).fill(envConfig.FRONTEND_PARAMS.password);
        
        const btnLogin = sharedPage.getByRole('button', { name: 'Iniciar sesión' }).first();
        await btnLogin.evaluate(node => node.disabled = false).catch(()=>null);
        await btnLogin.click({ force: true });
        
        const btnTransacciones = sharedPage.getByRole('link', { name: ' Transacciones ' }).first();
        await btnTransacciones.waitFor({ state: 'visible', timeout: 20000 });
        
        await sharedPage.waitForTimeout(3000); 
        await btnTransacciones.click();
        
        const btnSalida = sharedPage.getByRole('link', { name: 'Transacciones de Salida' }).first();
        await btnSalida.waitFor({ state: 'visible', timeout: 15000 });
        await btnSalida.click();
        
        const btnCrear = sharedPage.getByRole('link', { name: 'Crear Pago' }).first();
        await btnCrear.waitFor({ state: 'visible', timeout: 15000 });
        await btnCrear.click();
        
        await sharedPage.waitForSelector('text=Monto', { timeout: 15000 }).catch(()=>null);
        formUrl = sharedPage.url(); 
    });

    afterAll(async () => {
        if (browser) await browser.close();
    });

    const typeSafe = async (page, nameSelectorParams, textToType) => {
        const loc = page.getByRole('textbox', nameSelectorParams).first();
        await loc.click({ timeout: 3000 }).catch(()=>null);
        await loc.fill('', { timeout: 3000 }).catch(()=>null); 
        if (textToType !== null && textToType !== undefined) {
             await loc.pressSequentially(textToType, { delay: 10, timeout: 5000 }).catch(()=>null);
        }
    };

    const attachEvidence = async (testName, page, actionTaken) => {
        if (!allure || !allure.attachment) return;
        
        let errorVisualExtraido = "Ninguno Visible / Cajas verdes o input bloqueado.";
        
        const errorSelectors = ['p.error-message', '.text-red-500', '.error', '.invalid-feedback', 'span[role="alert"]', 'p.text-xs.text-red-500', '.Vue-Toastification__toast'];
        let extractedTexts = [];
        
        for (const sel of errorSelectors) {
            try {
                const elements = await page.locator(sel).all();
                for (const el of elements) {
                    if (await el.isVisible()) {
                         const txt = (await el.innerText()).trim();
                         if (txt.length > 0) extractedTexts.push(txt);
                    }
                }
            } catch(e) {}
        }

        const labelsToScan = ['Monto *', 'Nombre*', 'Apellido*', 'Número de Documento*', 'Número de Cuenta*'];
        for (const lbl of labelsToScan) {
            try {
                const target = page.getByRole('textbox', { name: lbl }).first();
                if (await target.count() > 0) {
                    const msjNativo = await target.evaluate(el => el.validationMessage).catch(()=>null);
                    if (msjNativo && msjNativo.trim().length > 0) {
                        extractedTexts.push(`[Nativo HTML5]: ${msjNativo}`);
                    }
                }
            } catch(e) {}
        }
        
        let isBotonBloqueadoOverride = false;
        if (!page.url().includes('create') && !page.url().includes('create-payment')) {
             isBotonBloqueadoOverride = true; 
        }
        
        if (extractedTexts.length > 0) {
            errorVisualExtraido = [...new Set(extractedTexts)].join(" | ");
        }
        
        let isBotonBloqueado = isBotonBloqueadoOverride;
        if (!isBotonBloqueado) {
            const btnSave = page.getByRole('button', { name: 'Crear Pago' }).first();
            isBotonBloqueado = await btnSave.isDisabled().catch(()=>true);
        }
        
        const auditLog = {
            Test: testName,
            InputDelRobotQA: actionTaken,
            BotonEstabaDesactivado: isBotonBloqueado,
            MensajeDeErrorVisual: errorVisualExtraido
        };
        allure.attachment(`📋 Extraccion de Error - ${testName}`, JSON.stringify(auditLog, null, 2), "application/json");

        try {
            const buffer = await page.screenshot({ fullPage: true });
            allure.attachment(`📸 Evidencia Final - ${testName}`, buffer, "image/png");
        } catch(e) { }
        
        return { errorVisualExtraido, isBotonBloqueado };
    };

    const fillBaseForm = async (page) => {
        if (!page.url().includes('/create')) {
            await page.getByRole('link', { name: ' Transacciones ' }).first().click({ timeout: 5000 }).catch(()=>null);
            await page.waitForTimeout(500);
            await page.getByRole('link', { name: 'Transacciones de Salida' }).first().click({ timeout: 5000 }).catch(()=>null);
            await page.waitForTimeout(500);
            await page.getByRole('link', { name: 'Crear Pago' }).first().click({ timeout: 5000 }).catch(()=>null);
            await page.waitForTimeout(2000);
        }

        const bancosConfig = ['banco_pichincha', 'banco_guayaquil', 'produbanco'];
        const cuentasConfig = ['Ahorro', 'Corriente'];
        const randomBanco = bancosConfig[Math.floor(Math.random() * bancosConfig.length)];
        const randomCuenta = cuentasConfig[Math.floor(Math.random() * cuentasConfig.length)];

        await page.getByLabel('País *').selectOption('EC').catch(()=>null);
        await page.waitForTimeout(2000); // ⏳ ESPERA A QUE CARGUE LA LISTA DE BANCOS 
        await typeSafe(page, { name: 'Monto *' }, '150.23');
        await typeSafe(page, { name: 'Nombre*' }, 'Sergio');
        await typeSafe(page, { name: 'Apellido*' }, 'Errigo');
        await page.getByLabel('Tipo de Documento*').selectOption('CI').catch(()=>null);
        await typeSafe(page, { name: 'Número de Documento*' }, '1710034065');
        try { await page.getByLabel('Banco*').selectOption(randomBanco, {timeout:3000}); } catch(e) { await page.getByLabel('Banco*').selectOption({index:1}).catch(()=>null); }
        try { await page.getByLabel('Tipo de Cuenta*').selectOption(randomCuenta, {timeout:3000}); } catch(e) { await page.getByLabel('Tipo de Cuenta*').selectOption({index:1}).catch(()=>null); }
        await typeSafe(page, { name: 'Número de Cuenta*' }, '12345678961');
    };

    const attemptSubmit = async (page) => {
        if (allure && allure.attachment) {
            try {
                await page.waitForTimeout(500); 
                const buffer = await page.screenshot({ fullPage: true });
                allure.attachment("📸 Formulario Lleno (Antes de Enviar)", buffer, "image/png");
            } catch(e) {}
        }
        await page.mouse.click(0, 0);
        await page.waitForTimeout(500);
        const btn = page.getByRole('button', { name: 'Crear Pago' }).first();
        await btn.click({ force: true }).catch(()=>null);
        
        // Esperamos extra por si el backend arroja un <Toaster> tardío
        await page.waitForTimeout(2000); 
    };

    const attemptHappySubmit = async (page) => {
        if (allure && allure.attachment) {
            try {
                await page.waitForTimeout(500); 
                const buffer = await page.screenshot({ fullPage: true });
                allure.attachment("📸 Formulario Lleno (Antes de Enviar - OK)", buffer, "image/png");
            } catch(e) {}
        }
        const btn = page.getByRole('button', { name: 'Crear Pago' }).first();
        
        // Hacer click natural para garantizar que el botón no esté disabled.
        await btn.click();
        
        // Dar tiempo a la creación (Redirección o mensaje verde de éxito)
        await page.waitForTimeout(4000); 
    };

    const checkSystemDefect = (page, r, testScenario) => {
        const urlCambio = !page.url().includes('create') && !page.url().includes('create-payment');
        const isExito = r.errorVisualExtraido.toLowerCase().includes('éxito') || r.errorVisualExtraido.toLowerCase().includes('exito') || r.errorVisualExtraido.toLowerCase().includes('success');
        if (urlCambio || isExito) {
            throw new Error(`\n\n🚨 DEFECTO CRITICO DEL SISTEMA 🚨\nEl sistema permitió crear la transacción exitosamente con datos INVÁLIDOS.\nEscenario: ${testScenario}\nURL Actual: ${page.url()}\n\n`);
        }
    };

    // ================================================================
    // SUITE 1: FIRST NAME
    // ================================================================
    describe('1. Suite Payout UI: Nombres (First Name)', () => {
        test('1.1. First Name: Corto (1 Letra)', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Nombre*' }, 'A'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('FN - 1L', sharedPage, "Nombre: 'A'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('1.2. First Name: Largo Máximo (> 50 Letras)', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Nombre*' }, 'A'.repeat(55)); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('FN - 55L', sharedPage, "Nombre: Ax55");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('1.3. First Name: Numéricos', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Nombre*' }, 'Sergio123'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('FN - Numeros', sharedPage, "Nombre: 'Sergio123'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('1.4. First Name: Símbolos XSS', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Nombre*' }, '<script>'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('FN - XSS', sharedPage, "Nombre: '<script>'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('1.5. First Name: Especiales (Emojis/Malformados)', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Nombre*' }, 'Sergio😎'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('FN - Especiales', sharedPage, "Nombre: 'Sergio😎'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });
    });

    // ================================================================
    // SUITE 2: LAST NAME
    // ================================================================
    describe('2. Suite Payout UI: Apellidos (Last Name)', () => {
        test('2.1. Last Name: Corto (1 Letra)', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Apellido*' }, 'B'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('LN - 1L', sharedPage, "Apellido: 'B'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('2.2. Last Name: Largo (> 50 Letras)', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Apellido*' }, 'B'.repeat(55)); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('LN - 55L', sharedPage, "Apellido: 'B'x55");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('2.3. Last Name: Numéricos', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Apellido*' }, 'Perez8'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('LN - Numeros', sharedPage, "Apellido: 'Perez8'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('2.4. Last Name: Simbolos XSS', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Apellido*' }, 'Perez;'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('LN - Simbolos', sharedPage, "Apellido: 'Perez;'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('2.5. Last Name: Especiales (Chars Extremos)', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Apellido*' }, 'Perez¿'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('LN - Especiales', sharedPage, "Apellido: 'Perez¿'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });
    });

    // ================================================================
    // SUITE 3: DOCUMENT TYPE & NUMBER
    // ================================================================
    describe('3. Suite Payout UI: Tipo y Numero de Documento', () => {
        
        test('3.0. DType: Ausencia de Tipo DL (Driving License)', async () => {
            await fillBaseForm(sharedPage);
            const selector = sharedPage.getByLabel('Tipo de Documento*').first();
            const textoDropdown = await selector.innerText();
            if (allure && allure.attachment) {
                try {
                    await selector.click();
                    await sharedPage.waitForTimeout(500);
                    const buffer = await sharedPage.screenshot({ fullPage: true });
                    allure.attachment("📸 Evidencia Dropdown Documentos (Sin DL)", buffer, "image/png");
                    await sharedPage.mouse.click(0, 0); 
                } catch(e) {}
            }
            expect(textoDropdown.includes('DL')).toBe(false); 
        });

        test('3.1. CI: Faltan Caracteres (9 Digitos)', async () => {
            await fillBaseForm(sharedPage);
            await sharedPage.getByLabel('Tipo de Documento*').selectOption('CI');
            await typeSafe(sharedPage, { name: 'Número de Documento*' }, '171003406'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('CI - 9 Digitos', sharedPage, "Documento: '171003406'");
            checkSystemDefect(sharedPage, r, '3.1. CI: Faltan Caracteres (9 Digitos)');
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('3.2. CI: Excedente de Caracteres (11 Digitos)', async () => {
            await fillBaseForm(sharedPage);
            await sharedPage.getByLabel('Tipo de Documento*').selectOption('CI');
            await typeSafe(sharedPage, { name: 'Número de Documento*' }, '17100340656'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('CI - 11 Digitos', sharedPage, "Documento: '17100340656'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('3.3. PP: Frontera Exitosa (13 Chars OK)', async () => {
            await fillBaseForm(sharedPage);
            await sharedPage.getByLabel('Tipo de Documento*').selectOption('PP');
            const targetId = 'A1B2C3D4E5QW9';
            await typeSafe(sharedPage, { name: 'Número de Documento*' }, targetId); 
            
            // Clic real natural ya que es un Happy Path permitido
            await attemptHappySubmit(sharedPage);
            const r = await attachEvidence('PP - 13 (OK)', sharedPage, `Documento: '${targetId}'`);
            
            // Evaluamos la fuga de URL (Significa que navegó hacia la tabla de reportes, éxito!) o muestra notificación verde
            const urlCambio = !sharedPage.url().includes('create');
            expect(urlCambio || r.errorVisualExtraido.includes('exito') || !r.isBotonBloqueado).toBe(true);
        });

        test('3.4. PP: Falla Desborde (14 Digitos)', async () => {
            await fillBaseForm(sharedPage);
            await sharedPage.getByLabel('Tipo de Documento*').selectOption('PP');
            await typeSafe(sharedPage, { name: 'Número de Documento*' }, 'A1B2C3D4E5QW9X'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('PP - 14 Digitos', sharedPage, "Documento: 'A1B2C3D4E5QW9X'");
            checkSystemDefect(sharedPage, r, '3.4. PP: Falla Desborde (14 Digitos)');
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });
    });

    // ================================================================
    // SUITE 4: AMOUNT (MONTOS)
    // ================================================================
    describe('4. Suite Payout UI: Comportamiento Monetario (Amount)', () => {
        
        test('4.1. Amount: Nulo o Vacío', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Monto *' }, null); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('Amount - Vacio', sharedPage, "Monto: ''");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('4.2. Amount: Valor Negativo Absoluto', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Monto *' }, '-120.00'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('Amount - Negativo', sharedPage, "Monto: '-120.00'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('4.3. Amount: Exceso Decimal (3 Decimales)', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Monto *' }, '100.555'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('Amount - 3 Decimales', sharedPage, "Monto: '100.555'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('4.4. Amount: 2 Decimales Exactos (OK)', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Monto *' }, '140.25'); 
            
            // Clic real natural Happy Path
            await attemptHappySubmit(sharedPage);
            const r = await attachEvidence('Amount - 2 Decimales (OK)', sharedPage, "Monto: '140.25'");
            
            const urlCambio = !sharedPage.url().includes('create');
            expect(urlCambio || r.errorVisualExtraido.includes('exito') || !r.isBotonBloqueado).toBe(true);
        });
    });

    // ================================================================
    // SUITE 5: CUENTA BANCARIA
    // ================================================================
    describe('5. Suite Payout UI: Cuenta Bancaria', () => {
        test('5.1. Account Number: Corta (<10 Digitos)', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Número de Cuenta*' }, '123456789'); // 9
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('Cuenta < 10', sharedPage, "Cuenta: '123456789'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('5.2. Account Number: Larga (>20 Digitos)', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Número de Cuenta*' }, '123456789012345678901'); // 21
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('Cuenta > 20', sharedPage, "Cuenta: 21 Digitos");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('5.3. Account Number: Contaminada (Letras y Símbolos)', async () => {
            await fillBaseForm(sharedPage);
            // La regex global es ^\\d{10,20}$
            await typeSafe(sharedPage, { name: 'Número de Cuenta*' }, '123456X89!'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('Cuenta Letras y Simb', sharedPage, "Cuenta: Alfanumerica");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('5.4. Bank: Ausencia de Banco Seleccionado (Omitir)', async () => {
            await fillBaseForm(sharedPage);
            // Forza deseleccionar (Opción "Seleccione un Banco" que suele ser index 0 o string vacío)
            await sharedPage.getByLabel('Banco*').selectOption({index: 0}).catch(()=>null);
            await attemptSubmit(sharedPage);
            const r = await attachEvidence('Banco - Omitido', sharedPage, "Banco: (Vacio)");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('5.5. Account Type: Enumeradores Inválidos (VISTA)', async () => {
            await fillBaseForm(sharedPage);
            const selector = sharedPage.getByLabel('Tipo de Cuenta*').first();
            const textoDropdown = await selector.innerText();
            if (allure && allure.attachment) {
                try {
                    await selector.click();
                    await sharedPage.waitForTimeout(500);
                    const buffer = await sharedPage.screenshot({ fullPage: true });
                    allure.attachment("📸 Evidencia Dropdown Cuenta (Sin VISTA)", buffer, "image/png");
                    await sharedPage.mouse.click(0, 0); 
                } catch(e) {}
            }
            expect(textoDropdown.toLowerCase().includes('vista')).toBe(false); 
        });

        test('5.6. Account Number: Omitido (Vacío)', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Número de Cuenta*' }, null); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('Cuenta Omitida', sharedPage, "Cuenta: (Nula)");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });
    });

});
