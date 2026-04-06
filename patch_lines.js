const fs = require('fs');
let lines = fs.readFileSync('tests/payout/e2e_ui/payout_merchant_EC_interactivity.test.js', 'utf8').split(/\r?\n/);

let output = [];
for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // 1. replace in fillBaseForm
    if (line.includes("await page.getByLabel('País *').selectOption('EC').catch(()=>null);")) {
        output.push(line);
        output.push("        await page.waitForTimeout(2000); // ⏳ ESPERA A QUE CARGUE LA LISTA DE BANCOS DESDE LA API");
        continue;
    }

    if (line.includes("await page.getByLabel('Banco*').selectOption(randomBanco).catch(()=>null);")) {
        output.push("        try { await page.getByLabel('Banco*').selectOption(randomBanco, {timeout:3000}); } catch(e) { await page.getByLabel('Banco*').selectOption({index:1}).catch(()=>null); }");
        continue;
    }

    if (line.includes("await page.getByLabel('Tipo de Cuenta*').selectOption(randomCuenta).catch(()=>null);")) {
        output.push("        try { await page.getByLabel('Tipo de Cuenta*').selectOption(randomCuenta, {timeout:3000}); } catch(e) { await page.getByLabel('Tipo de Cuenta*').selectOption({index:1}).catch(()=>null); }");
        continue;
    }

    if (line.includes("// ================================================================") && lines[i+1] && lines[i+1].includes("// SUITE 1: FIRST NAME") && lines[i-1] && lines[i-1].includes("};")) {
        // Insert it right before SUITE 1 pattern
        output.push(`    const checkSystemDefect = (page, r, testScenario) => {
        const urlCambio = !page.url().includes('create') && !page.url().includes('create-payment');
        const isExito = r.errorVisualExtraido.toLowerCase().includes('éxito') || r.errorVisualExtraido.toLowerCase().includes('exito') || r.errorVisualExtraido.toLowerCase().includes('success');
        if (urlCambio || isExito) {
            throw new Error(\`\\n\\n🚨 FALLA DEL SISTEMA 🚨\\nEl sistema permitió crear la transacción exitosamente con datos INVÁLIDOS.\\nEscenario Crítico: \${testScenario}\\nURL Actual: \${page.url()}\\n\`);
        }
    };
`);
        output.push(line);
        continue;
    }

    // 3. Update case 3.0
    if (line.includes("expect(textoDropdown.includes('DL')).toBe(false);") && lines[i-1].includes("const textoDropdown = await selector.innerText();")) {
        output.push(`            if (allure && allure.attachment) {
                try {
                    await selector.click();
                    await sharedPage.waitForTimeout(500);
                    const buffer = await sharedPage.screenshot({ fullPage: true });
                    allure.attachment("📸 Evidencia Dropdown Documentos (Sin DL)", buffer, "image/png");
                    await sharedPage.mouse.click(0, 0); 
                } catch(e) {}
            }`);
        output.push(line);
        continue;
    }

    // 4. Inject checkSystemDefect to ALL expects for negative tests (which check isBotonBloqueado)
    if (line.includes("expect(r.isBotonBloqueado || r.errorVisualExtraido.length > 0).toBe(true);")) {
        // Find the test name from the previous line (attachEvidence)
        let prevLine = lines[i-1];
        let match = prevLine.match(/attachEvidence\('([^']+)'/);
        if (match) {
            output.push(`            checkSystemDefect(sharedPage, r, '${match[1]}');`);
        }
        output.push(line);
        continue;
    }

    output.push(line);
}

fs.writeFileSync('tests/payout/e2e_ui/payout_merchant_EC_interactivity.test.js', output.join('\\n'), 'utf8');
console.log("SUCCESSFULLY PATCHED VIA LINES!");
