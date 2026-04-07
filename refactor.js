const fs = require('fs');
const path = require('path');

const baseDir = __dirname;
let log = "Starting refactor in " + baseDir + "\n";

const dirs = [
    'tests/EC/DoPayment/Payin/H2H',
    'tests/EC/DoPayment/Payin/PayURL',
    'tests/EC/DoPayment/Payin/MerchantPortal',
    'tests/EC/DoPayment/Payout/H2H',
    'tests/EC/DoPayment/Payout/MerchantPortal'
];

dirs.forEach(d => {
    const fullPath = path.join(baseDir, d);
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        log += "Created: " + d + "\n";
    }
});

const moves = [
    { src: 'tests/payin/validations/payinH2H_EC.test.js', dest: 'tests/EC/DoPayment/Payin/H2H/payin_h2h_val.test.js' },
    { src: 'tests/payin/e2e_ui/payurl_EC_interactivity.test.js', dest: 'tests/EC/DoPayment/Payin/PayURL/payurl_ui_val.test.js' },
    { src: 'tests/payin/validations/payurl_EC.test.js', dest: 'tests/EC/DoPayment/Payin/PayURL/payurl_api_val.test.js' },
    { src: 'tests/payin/e2e_ui/paymentlink_merchant_EC_interactivity.test.js', dest: 'tests/EC/DoPayment/Payin/MerchantPortal/merchant_payin_ui_val.test.js' },
    { src: 'tests/payin/e2e_ui/paymentlink_merchant_EC.test.js', dest: 'tests/EC/DoPayment/Payin/MerchantPortal/merchant_payin_api_val.test.js' },
    { src: 'tests/payout/validations/payout_H2H_EC.test.js', dest: 'tests/EC/DoPayment/Payout/H2H/payout_h2h_val.test.js' },
    { src: 'tests/payout/e2e_ui/payout_merchant_EC_interactivity.test.js', dest: 'tests/EC/DoPayment/Payout/MerchantPortal/merchant_payout_ui_val.test.js' },
    { src: 'tests/payout/e2e_ui/payout_merchant_EC.flow.test.js', dest: 'tests/EC/DoPayment/Payout/MerchantPortal/merchant_payout_flow.test.js' },
    { src: 'tests/payin/validations/config_EC.test.js', dest: 'tests/EC/DoPayment/Payin/config_EC.test.js' },
    { src: 'tests/payin/validations/config_AR.test.js', dest: 'tests/EC/DoPayment/Payin/config_AR.test.js' }
];

moves.forEach(m => {
    const srcPath = path.join(baseDir, m.src);
    const destPath = path.join(baseDir, m.dest);
    if (fs.existsSync(srcPath)) {
        try {
            fs.renameSync(srcPath, destPath);
            log += `Moved: ${m.src} -> ${m.dest}\n`;
        } catch (e) {
            log += `Error moving ${m.src}: ${e.message}\n`;
        }
    } else {
        log += `File missing, could not move: ${m.src}\n`;
    }
});

fs.writeFileSync(path.join(baseDir, 'refactor.log'), log, 'utf8');
