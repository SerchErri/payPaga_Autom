const envConfig = require('./envConfig');
const axios = require('axios');

/**
 * Utilitario Core E2E: uiBalanceHelper
 * Módulo para centralizar la verificación omnicanal de saldos en UI y la aprobación instantánea Admin, 
 * sin importar si la transacción se originó mediante Interfaz de Usuario o llamando directamente a la API (H2H/Payurl).
 */

const scrapeBalances = async (page) => {
    return await page.evaluate(() => {
        const cleanVal = (txt) => parseFloat(txt.replace(/[^0-9.-]+/g, "") || "0");
        const flexCountry = Array.from(document.querySelectorAll('div.flex.items-center')).find(d => d.innerText.trim() === 'EC');
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
    });
};

/**
 * Inicia sesión en Merchant Portal, obtiene los saldos actuales de EC y toma la fotografía acotada.
 */
const loginAndCaptureDashboard = async (page, allure, isInitial = true) => {
    let baseURL = envConfig.BASE_URL;
    const domainRoot = baseURL.replace("api", "admin").replace("admin", "merchant"); 
    let loginUrl = `${domainRoot}/login`; 
    if(!loginUrl.includes('merchant')) loginUrl = envConfig.FRONTEND_URL || "https://merchant.v2.dev.paypaga.com/login";

    await page.goto(loginUrl, { waitUntil: 'networkidle' });
    
    // Login
    await page.waitForSelector('input[type="email"]', { timeout: 15000 }).catch(()=>null);
    await page.getByRole('textbox', { name: 'Email' }).fill(envConfig.FRONTEND_PARAMS.email);
    await page.getByRole('textbox', { name: 'Contraseña' }).fill(envConfig.FRONTEND_PARAMS.password);
    
    const btnLogin = page.getByRole('button', { name: 'Iniciar sesión' }).first();
    await btnLogin.evaluate(node => node.disabled = false).catch(()=>null);
    await btnLogin.click({ force: true });
    
    await page.waitForSelector('h3.text-2xl', { timeout: 20000 }).catch(()=>null);
    await page.waitForTimeout(3000); 

    const balances = await scrapeBalances(page);
    
    // Autofocus y foto específica a Ecuador
    const countryCard = page.locator('div.snap-start', { has: page.locator('img[alt="EC flag"]') }).first();
    await countryCard.scrollIntoViewIfNeeded().catch(()=>null);
    await page.waitForTimeout(800);

    if(allure && allure.attachment){
        try {
            const cardBuffer = await countryCard.screenshot();
            await allure.attachment(`📸 Evidencia Visual: Tablero de EC (${isInitial ? 'Antes de ejecutar operación' : 'Impacto confirmado'})`, cardBuffer, "image/png");
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
    await page.waitForSelector('input[type="email"]', { timeout: 15000 }).catch(()=>null);
    await page.getByRole('textbox', { name: /Email/i }).fill("serrigo@paypaga.com");
    await page.locator('input[type="password"]').fill("P@assword.");
    
    const btnLoginAdmin = page.locator('button[type="submit"]').first();
    await btnLoginAdmin.evaluate(node => node.disabled = false).catch(()=>null);
    await btnLoginAdmin.click({ force: true });
    
    await page.waitForTimeout(4000); 

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

module.exports = {
    loginAndCaptureDashboard,
    fastAdminAction,
    scrapeBalances,
    preLoadFunds
};
