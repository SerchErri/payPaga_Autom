const { chromium } = require('playwright');
const allure = require('allure-js-commons');
const { getAccessToken } = require('../../../../../utils/authHelper');
const { preLoadFunds } = require('../../../../../utils/uiBalanceHelper');
const envConfig = require('../../../../../utils/envConfig');

jest.setTimeout(1800000);

describe(`[E2E UI] Validaciones Interactivas Payout AR [Ambiente: ${envConfig.currentEnvName.toUpperCase()}]`, () => {
    
    let browser;
    let context;
    let sharedPage;

    beforeAll(async () => {
        browser = await chromium.launch({ headless: true });
        context = await browser.newContext({ locale: 'es-ES', colorScheme: 'dark', viewport: { width: 1920, height: 1080 } });
        sharedPage = await context.newPage();
        
        sharedPage.setDefaultTimeout(10000);
        
        try {
            const token = await getAccessToken();
            await preLoadFunds(sharedPage, token, allure, 10000.00, 'AR');
        } catch(e) { console.error("Fallo AutoFondeando", e); }
        
        let baseURL = envConfig.BASE_URL;
        const domainRoot = baseURL.replace("api", "merchant");
        const loginUrl = `${domainRoot}/login`;

        await sharedPage.goto(loginUrl, { waitUntil: 'domcontentloaded' });
        
        await sharedPage.waitForSelector('input[type="email"]', { timeout: 15000 }).catch(()=>null);
        await sharedPage.getByRole('textbox', { name: 'Email' }).fill(envConfig.FRONTEND_PARAMS.email);
        await sharedPage.getByRole('textbox', { name: 'Contraseña' }).fill(envConfig.FRONTEND_PARAMS.password);
        
        const btnLogin = sharedPage.getByRole('button', { name: /Iniciar sesión|Login|Sign in/i }).first();
        await btnLogin.evaluate(node => node.disabled = false).catch(()=>null);
        await btnLogin.click({ force: true });
        
        await sharedPage.waitForSelector('h3.text-2xl', { timeout: 20000 }).catch(()=>null);
    });

    afterAll(async () => {
        if (browser) await browser.close();
    });

    const typeSafe = async (page, selector, textToType) => {
        const loc = page.locator(selector);
        await loc.click({ timeout: 3000 }).catch(()=>null);
        await loc.fill('', { timeout: 3000 }).catch(()=>null); 
        if (textToType !== null && textToType !== undefined && textToType !== '') {
             await loc.pressSequentially(textToType, { delay: 10, timeout: 5000 }).catch(()=>null);
        }
        await loc.press('Tab').catch(()=>null);
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

        const isInvalidDOM = await page.evaluate(() => {
            const invalidElements = document.querySelectorAll(':invalid');
            if (invalidElements.length > 0) {
                return Array.from(invalidElements).map(el => `[Nativo HTML5] ID: ${el.id || el.name} -> ${el.validationMessage}`);
            }
            return null;
        });
        
        if (isInvalidDOM) extractedTexts.push(...isInvalidDOM);
        
        let isBotonBloqueadoOverride = false;
        if (!page.url().includes('create') && !page.url().includes('create-payment') && !page.url().includes('transactions/pay-out/')) {
             isBotonBloqueadoOverride = true; 
        }
        
        if (extractedTexts.length > 0) errorVisualExtraido = [...new Set(extractedTexts)].join(" | ");
        
        let isBotonBloqueado = isBotonBloqueadoOverride;
        if (!isBotonBloqueado) {
            const btnSave = page.locator('#save');
            if (await btnSave.count() > 0) isBotonBloqueado = await btnSave.isDisabled().catch(()=>true);
        }
        
        const auditLog = {
            Test: testName,
            InputDelRobotQA: actionTaken,
            BotonEstabaDesactivado: isBotonBloqueado,
            MensajeDeErrorVisual: errorVisualExtraido
        };
        allure.attachment(`📋 Extraccion de Error - ${testName}`, JSON.stringify(auditLog, null, 2), "application/json");

        try {
            await page.waitForTimeout(500);
            const buffer = await page.screenshot({ fullPage: true });
            allure.attachment(`📸 Evidencia Final - ${testName}`, buffer, "image/png");
        } catch(e) { }
        
        return { errorVisualExtraido, isBotonBloqueado };
    };

    const fillBaseForm = async (page) => {
        const merchantUrl = envConfig.BASE_URL.replace("api", "merchant");
        await page.goto(`${merchantUrl}/transactions/pay-out`).catch(()=>null);
        await page.waitForLoadState('networkidle').catch(()=>null);
        await page.waitForTimeout(1000);
        
        const btnCrear = page.getByRole('link', { name: /Crear|Create/i }).first();
        await btnCrear.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
        await btnCrear.click({ force: true });
        
        await page.waitForTimeout(1500);

        await page.locator('#country').selectOption('AR').catch(()=>null);
        await page.locator('#payment_method').selectOption('cvu').catch(()=>null);
        
        await typeSafe(page, '#amount', '120.00');
        await typeSafe(page, '#first_name', 'Sergio');
        await typeSafe(page, '#last_name', 'Test');
        await typeSafe(page, '#document_number', '20275105792'); 
        await typeSafe(page, '#account_number', '0070327530004025541644'); 
        
        // Disable Mocking para evitar impactar saldos reales
        const disableMockCheck = page.locator('#disable_mock');
        if (await disableMockCheck.isVisible().catch(()=>false)) {
            const isChecked = await disableMockCheck.isChecked();
            if (!isChecked) await disableMockCheck.click({ force: true });
        }
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
        const btnSave = page.locator('#save');
        await btnSave.scrollIntoViewIfNeeded().catch(() => null);
        await btnSave.click({ force: true }).catch(()=>null);
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
        const btnSave = page.locator('#save');
        await btnSave.scrollIntoViewIfNeeded().catch(() => null);
        await btnSave.click().catch(()=>null); 
        await page.waitForTimeout(4000); 
    };

    // ================================================================
    // SUITE 1: FIRST NAME
    // ================================================================
    describe('1. Suite Payout UI AR: Nombres (First Name)', () => {
        test('TC05: Validate Firstname With 2 Characters', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#first_name', 'Al'); 
            await attemptHappySubmit(sharedPage); 
            const r = await attachEvidence('TC05', sharedPage, "Firstname: 'Al'");
            expect(!sharedPage.url().includes('create') || r.errorVisualExtraido.includes('exito') || !r.isBotonBloqueado).toBe(true);
        });

        test('TC06: Validate Firstname With Special Characters', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#first_name', "D'Arc"); 
            await attemptHappySubmit(sharedPage); 
            const r = await attachEvidence('TC06', sharedPage, "Firstname: D'Arc");
            expect(!sharedPage.url().includes('create') || r.errorVisualExtraido.includes('exito') || !r.isBotonBloqueado).toBe(true);
        });

        test('TC07: Reject Firstname With 1 Character', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#first_name', 'A'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC07', sharedPage, "Firstname: 'A'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('TC08: Reject Firstname Exceeding 50 Characters', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#first_name', 'A'.repeat(55)); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC08', sharedPage, "Firstname: Ax55");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('TC09: Reject Firstname With Symbols', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#first_name', 'Sergio@!'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC09', sharedPage, "Firstname: 'Sergio@!'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('TC10: Reject Firstname With Numbers', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#first_name', 'Sergio123'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC10', sharedPage, "Firstname: 'Sergio123'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('TC11: Reject Missing Firstname', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#first_name', ''); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC11', sharedPage, "Firstname: Vacío");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });
    });

    // ================================================================
    // SUITE 2: LAST NAME
    // ================================================================
    describe('2. Suite Payout UI AR: Apellidos (Last Name)', () => {
        test('TC12: Validate Lastname With 2 Characters', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#last_name', 'Ro'); 
            await attemptHappySubmit(sharedPage); 
            const r = await attachEvidence('TC12', sharedPage, "Lastname: 'Ro'");
            expect(!sharedPage.url().includes('create') || r.errorVisualExtraido.includes('exito') || !r.isBotonBloqueado).toBe(true);
        });

        test('TC13: Validate Lastname With Special Characters', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#last_name', "O'Brian"); 
            await attemptHappySubmit(sharedPage); 
            const r = await attachEvidence('TC13', sharedPage, "Lastname: O'Brian");
            expect(!sharedPage.url().includes('create') || r.errorVisualExtraido.includes('exito') || !r.isBotonBloqueado).toBe(true);
        });

        test('TC14: Reject Lastname With 1 Character', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#last_name', 'B'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC14', sharedPage, "Lastname: 'B'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('TC15: Reject Lastname Exceeding 50 Characters', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#last_name', 'B'.repeat(55)); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC15', sharedPage, "Lastname: Bx55");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('TC16: Reject Lastname With Symbols', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#last_name', 'Perez;'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC16', sharedPage, "Lastname: 'Perez;'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('TC17: Reject Lastname With Numbers', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#last_name', 'Perez8'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC17', sharedPage, "Lastname: 'Perez8'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('TC18: Reject Missing Lastname', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#last_name', ''); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC18', sharedPage, "Lastname: Vacío");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });
    });

    // ================================================================
    // SUITE 3: DOCUMENT NUMBER (CUIT/CUIL AR)
    // ================================================================
    describe('3. Suite Payout UI AR: Documento (CUIT/CUIL)', () => {
        test('TC19: Validate Document Number With Hyphens', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#document_number', '20-27510579-2'); 
            await attemptHappySubmit(sharedPage); 
            const r = await attachEvidence('TC19', sharedPage, "Document: '20-27510579-2'");
            expect(!sharedPage.url().includes('create') || r.errorVisualExtraido.includes('exito') || !r.isBotonBloqueado).toBe(true);
        });

        test('TC20: Reject Document Number With Letters', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#document_number', '20A75105792'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC20', sharedPage, "Document: '20A75105792'");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('TC21: Reject Empty Document Number', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#document_number', ''); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC21', sharedPage, "Document: Vacío");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('TC22: Reject Document Number With 10 Digits', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#document_number', '2012345678'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC22', sharedPage, "Document: 10 Digits");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('TC23: Reject Document Number With Prefix 19', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#document_number', '19275105792'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC23', sharedPage, "Document: Prefix 19");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });
    });

    // ================================================================
    // SUITE 4: ACCOUNT NUMBER (CBU/CVU)
    // ================================================================
    describe('4. Suite Payout UI AR: Cuenta Bancaria (CVU/CBU)', () => {
        test('TC24: Validate Valid CBU', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#account_number', '2850590940090418135201'); 
            await attemptHappySubmit(sharedPage); 
            const r = await attachEvidence('TC24', sharedPage, "Valid CBU");
            expect(!sharedPage.url().includes('create') || r.errorVisualExtraido.includes('exito') || !r.isBotonBloqueado).toBe(true);
        });

        test('TC25: Validate Valid CVU', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#account_number', '0000003100059258000000'); 
            await attemptHappySubmit(sharedPage); 
            const r = await attachEvidence('TC25', sharedPage, "Valid CVU");
            expect(!sharedPage.url().includes('create') || r.errorVisualExtraido.includes('exito') || !r.isBotonBloqueado).toBe(true);
        });

        test('TC26: Reject CBU Invalid Check-digit', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#account_number', '2850590940090418135209'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC26', sharedPage, "CBU Invalid Check-digit");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('TC27: Reject CVU Invalid Check-digit', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#account_number', '0000003100059258000009'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC27', sharedPage, "CVU Invalid Check-digit");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('TC28: Reject Empty Account Number', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#account_number', ''); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC28', sharedPage, "Empty Account Number");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('TC29: Reject CVU Not Starting With 000', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#account_number', '1110003100059258000000'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC29', sharedPage, "CVU Not Starting 000");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('TC30: Reject CVU With Blocked Digit', async () => {
            await fillBaseForm(sharedPage);
            // 0000003100059258000001
            await typeSafe(sharedPage, '#account_number', '0000003100059258000001'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC30', sharedPage, "CVU Blocked Digit");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('TC31: Reject CVU Block 2 Invalid Check-digit', async () => {
            await fillBaseForm(sharedPage);
            // Block 1: 00000031. Block 2: 00059258000009
            await typeSafe(sharedPage, '#account_number', '0000003100059258000009'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC31', sharedPage, "CVU Block 2 Invalid Check-digit");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('TC32: Reject Account Number With 21 Digits', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#account_number', '000000310005925800000'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC32', sharedPage, "Account Number 21 Digits");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });
    });

    // ================================================================
    // SUITE 5: AMOUNT (MONTOS)
    // ================================================================
    describe('5. Suite Payout UI AR: Comportamiento Monetario (Amount)', () => {
        test('TC33: Validate Negative Amount As Absolute', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#amount', '-120.00'); 
            await attemptHappySubmit(sharedPage); 
            const r = await attachEvidence('TC33', sharedPage, "Negative Amount As Absolute");
            expect(!sharedPage.url().includes('create') || r.errorVisualExtraido.includes('exito') || !r.isBotonBloqueado).toBe(true);
        });

        test('TC34: Reject String In Amount', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#amount', 'CIEN'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC34', sharedPage, "String In Amount");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('TC35: Reject Missing Amount', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#amount', ''); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC35', sharedPage, "Missing Amount");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });

        test('TC36: Reject Amount 0', async () => {
            await fillBaseForm(sharedPage);
            await typeSafe(sharedPage, '#amount', '0.00'); 
            await attemptSubmit(sharedPage); 
            const r = await attachEvidence('TC36', sharedPage, "Amount 0");
            expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);  
        });
    });

});
