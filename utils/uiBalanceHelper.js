const envConfig = require('./envConfig');
const axios = require('axios');

/**
 * Utilitario Core E2E: uiBalanceHelper
 * Módulo para centralizar la verificación omnicanal de saldos en UI y la aprobación instantánea Admin, 
 * sin importar si la transacción se originó mediante Interfaz de Usuario o llamando directamente a la API (H2H/Payurl).
 */

const scrapeBalances = async (page, countryCode = 'EC') => {
    return await page.evaluate((cc) => {
        const cleanVal = (txt) => parseFloat(txt.replace(/[^0-9.-]+/g, "") || "0");
        const flexCountry = Array.from(document.querySelectorAll('div.flex.items-center')).find(d => d.innerText.trim() === cc);
        if(!flexCountry) return { general: 0, available: 0, withdrawals: 0, fees: 0, taxes: 0 };
        
        const countryContainer = flexCountry.closest('div.rounded-2xl');
        if(!countryContainer) return { general: 0, available: 0, withdrawals: 0, fees: 0, taxes: 0 };

        let general = 0;
        const h3General = flexCountry.parentElement.querySelector('h3');
        if (h3General) general = cleanVal(h3General.innerText);

        let available = 0;
        const availEl = Array.from(countryContainer.querySelectorAll('div.text-right')).find(d => d.innerText.includes('Disponible para pagos'));
        if (availEl) available = cleanVal(availEl.innerText);

        const getMetric = (iconClass) => {
            const icon = countryContainer.querySelector(`em.${iconClass}`);
            if(!icon) return 0;
            const wrapper = icon.closest('div.rounded-lg');
            return wrapper ? cleanVal(wrapper.lastElementChild.innerText) : 0;
        };

        return {
            general,
            available,
            withdrawals: getMetric('ni-signout'), // Payouts
            volume: getMetric('ni-growth'), // Payins
            fees: getMetric('ni-coin'),
            taxes: getMetric('ni-reports')
        };
    }, countryCode);
};

/**
 * Inicia sesión en Merchant Portal, obtiene los saldos actuales y toma la fotografía acotada al país.
 */
const loginAndCaptureDashboard = async (page, allure, isInitial = true, countryCode = 'EC') => {
    let baseURL = envConfig.BASE_URL;
    const domainRoot = baseURL.replace("api", "admin").replace("admin", "merchant"); 
    let loginUrl = `${domainRoot}/login`; 
    if(!loginUrl.includes('merchant')) loginUrl = envConfig.FRONTEND_URL || "https://merchant.v2.dev.paypaga.com/login";

    await page.goto(loginUrl, { waitUntil: 'networkidle' });
    
    // Login
    const mercEmailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="Email"]').first();
    if(await mercEmailInput.isVisible({ timeout: 5000 }).catch(()=>false)){
        await mercEmailInput.fill(envConfig.FRONTEND_PARAMS.email);
        await page.locator('input[type="password"]').fill(envConfig.FRONTEND_PARAMS.password);
        const btnLogin = page.getByRole('button', { name: /Iniciar sesión|Login|Sign in/i }).first();
        await btnLogin.evaluate(node => node.disabled = false).catch(()=>null);
        await btnLogin.click({ force: true });
    }
    
    await page.waitForSelector('h3.text-2xl', { timeout: 20000 }).catch(()=>null);
    await page.waitForTimeout(3000); 

    const balances = await scrapeBalances(page, countryCode);
    
    // Autofocus y foto específica
    const countryCard = page.locator('div.snap-start', { has: page.locator(`img[alt="${countryCode} flag"]`) }).first();
    await countryCard.scrollIntoViewIfNeeded().catch(()=>null);
    await page.waitForTimeout(800);

    if(allure && allure.attachment){
        try {
            const cardBuffer = await countryCard.screenshot();
            await allure.attachment(`📸 Evidencia Visual: Tablero de ${countryCode} (${isInitial ? 'Antes de ejecutar operación' : 'Impacto confirmado'})`, cardBuffer, "image/png");
        } catch(e){}
    }

    return balances;
};

/**
 * Se dirige silenciosamente al backend de Admin y dispara la acción solicitada bypasseando la UI lenta.
 */
const fastAdminAction = async (page, txId, operationType = 'pay-out', allure, action = 'approve') => {
    let currentEnv = (envConfig.currentEnvName || "dev").toLowerCase();
    let adminUrl = `https://admin.v2.${currentEnv}.paypaga.com/login`;

    await page.goto(adminUrl, { waitUntil: 'networkidle' });
    
    // Login Admin
    const emailInput = page.locator('input[type="email"]');
    if (await emailInput.isVisible({ timeout: 5000 }).catch(()=>false)) {
        await emailInput.fill("serrigo@paypaga.com");
        await page.locator('input[type="password"]').fill("P@assword.");
        const btnLoginAdmin = page.locator('button[type="submit"]').first();
        await btnLoginAdmin.evaluate(node => node.disabled = false).catch(()=>null);
        await btnLoginAdmin.click({ force: true });
        await page.waitForTimeout(4000); 
    }

    // Disparar Acción (Aprueba o Rechaza la Tx)
    const merchantId = envConfig.FRONTEND_PARAMS.merchantId;
    const actionUrl = `https://admin.v2.${currentEnv}.paypaga.com/transactions/${operationType}/${txId}/${action}?merchant_id=${merchantId}`;
    
    await page.goto(actionUrl, { waitUntil: 'domcontentloaded' }).catch(()=>null);
    await page.waitForTimeout(2000); // Dar unos segundos al backend para liquidar

    if (allure && allure.attachment) allure.attachment(`Aprobación Híbrida Ejecutada (${action.toUpperCase()})`, actionUrl, 'text/plain');

    // Logout
    await page.goto(`https://admin.v2.${currentEnv}.paypaga.com/logout`).catch(()=>null);
};

/**
 * Función visual para recorrer la grilla del admin y aprobar visualmente (para reemplazar fastAdminAction).
 */
const visualAdminApprove = async (page, txId, operationType = 'pay-in', allure) => {
    let currentEnv = (envConfig.currentEnvName || "dev").toLowerCase();
    let adminUrl = `https://admin.v2.${currentEnv}.paypaga.com/login`;

    await page.goto(adminUrl, { waitUntil: 'networkidle' });
    
    // Login Admin
    const emailInput_v = page.locator('input[type="email"]');
    if (await emailInput_v.isVisible({ timeout: 5000 }).catch(()=>false)) {
        await emailInput_v.fill("serrigo@paypaga.com");
        await page.locator('input[type="password"]').fill("P@assword.");
        const btnLoginAdmin_v = page.locator('button[type="submit"]').first();
        await btnLoginAdmin_v.evaluate(node => node.disabled = false).catch(()=>null);
        await btnLoginAdmin_v.click({ force: true });
        await page.waitForTimeout(4000); 
    }

    // Navegar a la lista de Transacciones dependiendo del tipo
    if(operationType === 'pay-in') {
        await page.goto(`https://admin.v2.${currentEnv}.paypaga.com/transactions/pay-in`, { waitUntil: 'networkidle' });
    } else {
        await page.goto(`https://admin.v2.${currentEnv}.paypaga.com/transactions/pay-out`, { waitUntil: 'networkidle' });
    }

    await page.waitForTimeout(4000); // Esperar a que renderice la grilla

    // Buscar el botón dropdown en base al UUID
    const actionBtn = page.locator(`#actions-btn-${txId}`).first();
    await actionBtn.click({ timeout: 5000, force: true }).catch(async () => {
         console.log("Visual Admin: Fallback a búsqueda genérica...");
         const targetRow = page.locator('tr', { hasText: txId }).first();
         await targetRow.locator('button').last().click({ timeout: 4000 }).catch(()=>null);
    });

    await page.waitForTimeout(1000);

    // Clic en "Mark as approved"
    const stateBtn = page.getByText(/mark as approved|marcar como aprobada/i).first();
    await stateBtn.click({ force: true }).catch(()=>null);
    
    await page.waitForTimeout(5000); // Dar holgura a la validación UI

    if (allure && allure.attachment) {
        try {
            const buf = await page.screenshot({ fullPage: true });
            await allure.attachment(`Aprobación Visual en Modal Admin Completada`, buf, "image/png");
        } catch(e){}
    }

    // Logout
    await page.goto(`https://admin.v2.${currentEnv}.paypaga.com/logout`).catch(()=>null);
};

/**
 * Función visual para recorrer la grilla y marcar como fallida la transacción (Admin).
 */
const visualAdminFail = async (page, txId, operationType = 'pay-in', allure) => {
    let currentEnv = (envConfig.currentEnvName || "dev").toLowerCase();
    
    // Abrir pestaña aislada
    const context = page.context();
    const adminPage = await context.newPage();
    adminPage.setDefaultTimeout(20000);

    try {
        let adminUrl = `https://admin.v2.${currentEnv}.paypaga.com/login`;
        await adminPage.goto(adminUrl, { waitUntil: 'networkidle' });
        
        const emailInput_v = adminPage.locator('input[type="email"]');
        if (await emailInput_v.isVisible({ timeout: 5000 }).catch(()=>false)) {
            await emailInput_v.fill("serrigo@paypaga.com");
            await adminPage.locator('input[type="password"]').fill("P@assword.");
            const btnLoginAdmin_v = adminPage.locator('button[type="submit"]').first();
            await btnLoginAdmin_v.evaluate(node => node.disabled = false).catch(()=>null);
            await btnLoginAdmin_v.click({ force: true });
            await adminPage.waitForTimeout(4000); 
        }

        await adminPage.goto(`https://admin.v2.${currentEnv}.paypaga.com/transactions/${operationType}`, { waitUntil: 'networkidle' });
        await adminPage.waitForTimeout(4000); 

        // Wait for search box explicitly
        const searchInput = adminPage.locator('input[type="text"], input[placeholder*="Buscar"], input[placeholder*="Search"]').first();
        await searchInput.waitFor({ state: 'visible', timeout: 15000 }).catch(()=>console.log("No search box"));
        
        // Polling ElasticSearch delays
        let rowFound = false;
        for(let i=0; i<4; i++){
             await searchInput.fill(txId);
             await adminPage.keyboard.press('Enter');
             await adminPage.waitForTimeout(4000);
             if(await adminPage.locator('tr', { hasText: txId }).first().isVisible()){
                  rowFound = true;
                  break;
             }
        }

        if(rowFound) {
            const actionBtn = adminPage.locator(`#actions-btn-${txId}`).first();
            if(await actionBtn.isVisible()) {
                 await actionBtn.click({ force: true });
            } else {
                 await adminPage.locator('tr', { hasText: txId }).first().locator('button').last().click({ force: true });
            }
            await adminPage.waitForTimeout(1000);

            const stateBtn = adminPage.locator(`a[data-action="expire"], a[data-action="decline"], a[data-action="reject"]`).first();
            await stateBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(()=>null);
            if(await stateBtn.isVisible()) {
                 await stateBtn.click({ force: true });
                 await adminPage.waitForTimeout(1500);

                 // Wait up to 5 seconds for any confirm button to appear (handling modal fade-in delay)
                 const anyConfirmBtn = adminPage.locator('button:has-text("Confirm"), button:has-text("Aceptar"), button:has-text("Sí"), button:has-text("Yes"), button.swal2-confirm:visible, button.btn-primary:visible').first();
                 
                 try {
                     await anyConfirmBtn.waitFor({ state: 'visible', timeout: 5000 });
                     await anyConfirmBtn.click({ force: true });
                     console.log("Confirm button clicked!");
                 } catch (e) {
                     console.log("No confirm modal appeared or selector failed.");
                 }
                 
                 // Wait for page to refresh or modal to close
                 await adminPage.waitForTimeout(5000); 
            } else {
                 console.log("CRITICAL: Expire button not found in dropdown!");
            }
        } else {
            console.log("CRITICAL: Transaction not found in grid for expiration!");
        }

        if (allure && allure.attachment) {
            try {
                const targetRow = adminPage.locator('tr', { hasText: txId }).first();
                let buf;
                if(await targetRow.isVisible().catch(()=>false)){
                     buf = await targetRow.screenshot();
                } else {
                     buf = await adminPage.screenshot({ fullPage: true });
                }
                await allure.attachment(`Marcada como Fallida en Modal Admin`, buf, "image/png");
            } catch(e){}
        }
    } finally {
        await adminPage.close();
    }
};

/**
 * Automáticamente carga fondos a la cuenta usando un Pay-in fantasma y aprobándolo vía Admin, garantizando liquidez antes de correr suites.
 */
const preLoadFunds = async (page, token, allure, amountToLoad = 10000.00) => {
    try {
        const payinUrl = `${envConfig.BASE_URL}/v2/transactions/pay-in`;
        const payload = {
            country_code: 'EC', currency: 'USD', payment_method_code: 'bank_transfer',
            transaction: {
                beneficiary: { first_name: 'Auto', last_name: 'Funding', document_type: 'CI', document_number: '1710034065' },
                transaction_data: { merchant_transaction_reference: `Fund-${Date.now()}`, transaction_total: amountToLoad }
            }
        };
        const res = await axios.post(payinUrl, payload, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            validateStatus: () => true
        });

        if (res.status === 200 || res.status === 201 || res.status === 202) {
            let txId = res.data.transaction_id || res.data.id || (res.data.details && res.data.details.transaction_processed && res.data.details.transaction_processed.transaction_id);
            if (txId) {
                await fastAdminAction(page, txId, 'pay-in', null, 'approve');
                console.log(`[Auto-Funding] Inyectados $${amountToLoad} al balance del Merchant (TX: ${txId})`);
            }
        }
    } catch(e) {
        console.error("[Auto-Funding] Fallo silencioso fondeando la cuenta", e.message);
    }
};

/**
 * Configura el merchant en el portal Admin activando o desactivando allowOverUnder.
 */
const setPartnerAllowOverUnder = async (page, allow, allure) => {
    let currentEnv = (envConfig.currentEnvName || "dev").toLowerCase();
    const merchantId = envConfig.FRONTEND_PARAMS.merchantId;
    
    // Abrir una nueva pestaña para no interrumpir el Merchant UI (isolated flow)
    const context = page.context();
    const adminPage = await context.newPage();
    adminPage.setDefaultTimeout(15000);

    try {
        let adminUrl = `https://admin.v2.${currentEnv}.paypaga.com/login`;
        await adminPage.goto(adminUrl, { waitUntil: 'networkidle' });
        
        // Login Admin
        const emailInput_cnf = adminPage.locator('input[type="email"]');
        if (await emailInput_cnf.isVisible({ timeout: 5000 }).catch(()=>false)) {
            await emailInput_cnf.fill("serrigo@paypaga.com");
            await adminPage.locator('input[type="password"]').fill("P@assword.");
            const btnLoginAdmin_cnf = adminPage.locator('button[type="submit"]').first();
            await btnLoginAdmin_cnf.evaluate(node => node.disabled = false).catch(()=>null);
            await btnLoginAdmin_cnf.click({ force: true });
            await adminPage.waitForTimeout(3000);
        }

        // Navegar directamente al Merchant Partners bypasando la búsqueda ambigua
        await adminPage.goto(`https://admin.v2.${currentEnv}.paypaga.com/merchants/${merchantId}/partners`, { waitUntil: 'networkidle' });
        await adminPage.waitForTimeout(3000);

        // Seleccionar País (Argentina) y Método (cvu)
        await adminPage.selectOption('select#partners-country-select', 'AR').catch(()=>null);
        await adminPage.waitForTimeout(1000);
        await adminPage.selectOption('select#partners-method-select', 'cvu').catch(()=>null);
        await adminPage.waitForTimeout(2000);

        // Click Config Dinaria (genérico: el último botón de la primera fila)
        const firstRowBtn = adminPage.locator('table tbody tr').first().locator('button, a').last();
        await firstRowBtn.click({ force: true });
        await adminPage.waitForTimeout(2000);

        // Manipular modal: allowOverUnder
        const selectValue = allow ? "true" : "false";
        
        // Intentar múltiples selectores probables
        const selects = [
            'select#partner-field-allow-over-under',
            'select[name="allowOverUnder"]',
            'select[name*="allow"]',
            'div.modal select'
        ];
        
        let toggled = false;
        for(let sel of selects) {
            if(await adminPage.locator(sel).first().isVisible().catch(()=>false)){
                await adminPage.selectOption(sel, selectValue).catch(()=>null);
                toggled = true;
                break;
            }
        }
        
        if(!toggled) {
            // Checkbox fallback
            const chk = adminPage.locator('input[type="checkbox"][name*="allow"]').first();
            if(await chk.isVisible().catch(()=>false)){
                const isChecked = await chk.isChecked();
                if((allow && !isChecked) || (!allow && isChecked)){
                    await chk.click({ force: true });
                }
            }
        }
        await adminPage.waitForTimeout(1000);

        if (allure && allure.attachment) {
            try {
                const buffer = await adminPage.screenshot({ fullPage: true });
                await allure.attachment(`⚙️ UI Admin Config - allowOverUnder: ${allow}`, buffer, "image/png");
            } catch(e){}
        }

        // Trazar captura local para debugging del bot en background
        const fs = require('fs');
        const path = require('path');
        const dbgBuf = await adminPage.screenshot({ fullPage: true });
        fs.mkdirSync('artifacts', { recursive: true });
        fs.writeFileSync(path.join('artifacts', `debug_modal_${allow ? 'true' : 'false'}.png`), dbgBuf);

        // Click Botón Guardar
        const saveBtn = adminPage.locator('button#partner-config-save');
        await saveBtn.click({ force: true });
        await adminPage.waitForTimeout(2000);

    } catch(e) {
        console.error("Fallo interactuando con interfaz Admin (allowOverUnder):", e.message);
    } finally {
        await adminPage.close();
    }
};

module.exports = {
    loginAndCaptureDashboard,
    fastAdminAction,
    preLoadFunds,
    visualAdminApprove,
    visualAdminFail,
    setPartnerAllowOverUnder
};
