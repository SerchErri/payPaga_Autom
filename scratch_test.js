const fs = require('fs');

const file = 'tests/AR/Dinaria/Payin/PayURL/v1_payurl_api_val_dinaria_AR.test.js';
let content = fs.readFileSync(file, 'utf8');

// Remove TC01 and TC02
content = content.replace(/TC01 - Seguridad: /g, 'Seguridad: ');
content = content.replace(/TC02 - JSON Malformado/g, 'JSON Malformado');

// Replace TC03 -> TC01, TC04 -> TC02, ..., TC36 -> TC34
content = content.replace(/TC(\d{2})/g, (match, p1) => {
    let num = parseInt(p1, 10);
    if (num >= 3) {
        let newNum = num - 2;
        let padded = newNum.toString().padStart(2, '0');
        return `TC${padded}`;
    }
    return match; // fallback
});

fs.writeFileSync(file, content, 'utf8');
console.log("Replaced TCs.");
