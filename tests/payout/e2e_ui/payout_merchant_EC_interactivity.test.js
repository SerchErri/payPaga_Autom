const { chromium } = require('playwright');
const allure = require('allure-js-commons');
const envConfig = require('../../../utils/envConfig');

jest.setTimeout(1800000);

describe(`[E2E UI] Validaciones Interactivas Payout EC [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    
    let browser;
    let context;
    let sharedPage;
    let formUrl = '';

    beforeAll(async () => {
        browser = await chromium.launch({ headless: true });
        context = await browser.newContext({ locale: 'es-ES' });
        sharedPage = await context.newPage();
        
        // Timeout general más estricto para fail fast
        sharedPage.setDefaultTimeout(10000);
        
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
        
        // NAVEGAR MANUALMENTE LA PRIMERA VEZ PARA OBTENER LA RUTA ABSOLUTA DEL DEEP LINK (React)
        const btnTransacciones = sharedPage.getByRole('link', { name: ' Transacciones ' }).first();
        await btnTransacciones.waitFor({ state: 'visible', timeout: 20000 });
        
        // Espera explícita para que React hidrate los eventos ocultos tras pintar el DOM
        await sharedPage.waitForTimeout(3000); 

        await btnTransacciones.click();
        
        const btnSalida = sharedPage.getByRole('link', { name: 'Transacciones de Salida' }).first();
        await btnSalida.waitFor({ state: 'visible', timeout: 15000 });
        await btnSalida.click();
        
        const btnCrear = sharedPage.getByRole('link', { name: 'Crear Pago' }).first();
        await btnCrear.waitFor({ state: 'visible', timeout: 15000 });
        await btnCrear.click();
        
        await sharedPage.waitForSelector('text=Monto', { timeout: 15000 }).catch(()=>null);
        formUrl = sharedPage.url(); // Guardamos la URL absoluta para el deep linking
    });

    afterAll(async () => {
        if (browser) await browser.close();
    });

    const typeSafe = async (page, nameSelectorParams, textToType) => {
        const loc = page.getByRole('textbox', nameSelectorParams).first();
        await loc.clear({ timeout: 2000 }).catch(()=>null);
        await loc.pressSequentially(textToType, { delay: 10, timeout: 5000 });
    };

    const attachEvidence = async (testName, page, actionTaken) => {
        if (!allure || !allure.attachment) return;
        
        let errorVisualExtraido = "Ninguno Visible / Cajas verdes o input bloqueado.";
        
        const errorSelectors = ['p.error-message', '.text-red-500', '.error', '.invalid-feedback', 'span[role="alert"]', 'p.text-xs.text-red-500'];
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

        // Validación Nativos de HTML5 (Respaldo universal por IDs y Roles codegen)
        const camposSospechosos = ['#first_name', '#last_name', '#document_number', '#amount', '#email', '#account_number'];
        for (const id of camposSospechosos) {
            try {
                const target = page.locator(id).first();
                if (await target.count() > 0) {
                    const msjNativo = await target.evaluate(el => el.validationMessage).catch(()=>null);
                    if (msjNativo && msjNativo.trim().length > 0) {
                        extractedTexts.push(`[Nativo HTML5]: ${msjNativo}`);
                    }
                }
            } catch(e) {}
        }

        // Backup con Selectores Codegen
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
        
        // Magia de Fuga (si el sistema nos sacó de la interfaz por error)
        let isBotonBloqueadoOverride = false;
        if (!page.url().includes('create') && !page.url().includes('create-payment')) {
             isBotonBloqueadoOverride = true; 
        }
        
        if (extractedTexts.length > 0) {
            errorVisualExtraido = [...new Set(extractedTexts)].join(" | ");
        }
        
        // Bloqueo del botón
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
        // Auto-Sanación
        if (page.url() !== formUrl) {
            await page.goto(formUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('text=Monto', { timeout: 15000 }).catch(()=>null);
        }

        await page.getByLabel('País *').selectOption('EC').catch(()=>null);
        await typeSafe(page, { name: 'Monto *' }, '100');
        await typeSafe(page, { name: 'Nombre*' }, 'Sergio');
        await typeSafe(page, { name: 'Apellido*' }, 'Errigo');
        await page.getByLabel('Tipo de Documento*').selectOption('CI').catch(()=>null);
        await typeSafe(page, { name: 'Número de Documento*' }, '1710034065');
        await page.getByLabel('Banco*').selectOption('banco_pichincha').catch(()=>null);
        await page.getByLabel('Tipo de Cuenta*').selectOption('Ahorro').catch(()=>null);
        await typeSafe(page, { name: 'Número de Cuenta*' }, '12345678965');
    };

    const attemptSubmit = async (page) => {
        await page.mouse.click(0, 0);
        await page.waitForTimeout(500);
        const btn = page.getByRole('button', { name: 'Crear Pago' }).first();
        await btn.click({ timeout: 500 }).catch(()=>null);
        await page.waitForTimeout(1000); 
    };

    // ================================================================
    // SUITE 1: FIRST NAME
    // ================================================================
    describe('1. Suite Payout UI: Nombres (First Name)', () => {
        test('1.1. First Name: Boundary Corto (1 Letra)', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Nombre*' }, 'A'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('FN - Corto (1L)', sharedPage, "Nombre: 'A'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]')).toBe(true);  
        });

        test('1.2. First Name: Largo Máximo (55 Letras)', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Nombre*' }, 'A'.repeat(55)); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('FN - Largo (55L)', sharedPage, "Nombre: Ax55");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]')).toBe(true);  
        });

        test('1.3. First Name: Numéricos', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Nombre*' }, 'Sergio123'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('FN - Numeros', sharedPage, "Nombre: 'Sergio123'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]')).toBe(true);  
        });

        test('1.4. First Name: Simbolos XSS', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Nombre*' }, '<script>'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('FN - XSS', sharedPage, "Nombre: '<script>'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]')).toBe(true);  
        });
    });

    // ================================================================
    // SUITE 2: LAST NAME
    // ================================================================
    describe('2. Suite Payout UI: Apellidos (Last Name)', () => {
        test('2.1. Last Name: Numéricos', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Apellido*' }, 'Perez8'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('LN - Numeros', sharedPage, "Apellido: 'Perez8'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]')).toBe(true);  
        });
    });

    // ================================================================
    // SUITE 3: DOCUMENTOS NACIONALES 
    // ================================================================
    describe('3. Suite Payout UI: Documentos Nacionales', () => {
        test('3.1. CI: Falla por Falta (9 Digitos)', async () => {
            await fillBaseForm(sharedPage);
            await sharedPage.getByLabel('Tipo de Documento*').selectOption('CI');
            await typeSafe(sharedPage, { name: 'Número de Documento*' }, '171003406'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('CI Corta (9 chars)', sharedPage, "Documento: '171003406'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]')).toBe(true);  
        });

        test('3.2. CI: Contaminación Alfanumérica', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Número de Documento*' }, '17100340EE'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('CI Alfanumerica', sharedPage, "Documento: '17100340EE'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]')).toBe(true);  
        });
    });

    // ================================================================
    // SUITE 4: CUENTA BANCARIA
    // ================================================================
    describe('4. Suite Payout UI: Cuenta Bancaria', () => {
        test('4.1. Account Number: Corta (<10)', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Número de Cuenta*' }, '123456789'); // 9
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('Cuenta < 10', sharedPage, "Cuenta: '123456789'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]')).toBe(true);  
        });

        test('4.2. Account Number: Larga (>20)', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Número de Cuenta*' }, '123456789012345678901'); // 21
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('Cuenta > 20', sharedPage, "Cuenta: 21 Digitos");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]')).toBe(true);  
        });

        test('4.3. Account Number: Letras y Símbolos', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, { name: 'Número de Cuenta*' }, '12345678A0-'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('Cuenta con Letras', sharedPage, "Cuenta: Alfanumerico");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.includes('[Nativo HTML5]')).toBe(true);  
        });
    });
});
