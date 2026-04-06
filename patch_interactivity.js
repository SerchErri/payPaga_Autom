const fs = require('fs');
let content = fs.readFileSync('tests/payout/e2e_ui/payout_merchant_EC_interactivity.test.js', 'utf8');
content = content.replace(/\r\n/g, '\n');

// 1. Add checkSystemDefect definition
const helper = `
    const checkSystemDefect = (page, r, testScenario) => {
        const urlCambio = !page.url().includes('create') && !page.url().includes('create-payment');
        const isExito = r.errorVisualExtraido.toLowerCase().includes('éxito') || r.errorVisualExtraido.toLowerCase().includes('exito') || r.errorVisualExtraido.toLowerCase().includes('success');
        if (urlCambio || isExito) {
            throw new Error(\`\\n\\n🚨 FALLA DEL SISTEMA 🚨\\nEl sistema permitió crear la transacción exitosamente con datos INVÁLIDOS.\\nEscenario Crítico: \${testScenario}\\nURL Actual: \${page.url()}\\n\`);
        }
    };
`;
// Insert after attemptHappySubmit
content = content.replace(/await page\.waitForTimeout\(4000\);\s*};\s*/g, `await page.waitForTimeout(4000);\n    };\n${helper}\n`);

// 2. Add the wait logic and robust bank select into fillBaseForm
const formOriginal = `        await page.getByLabel('País *').selectOption('EC').catch(()=>null);\n        await typeSafe(page, { name: 'Monto *' }, '100.00');`;
const formNew = `        await page.getByLabel('País *').selectOption('EC').catch(()=>null);\n        await page.waitForTimeout(2000); // ⏳ ESPERA A QUE CARGUE LA LISTA DE BANCOS DESDE LA API\n        await typeSafe(page, { name: 'Monto *' }, '100.00');`;
content = content.replace(formOriginal, formNew);

// robust banks
content = content.replace(/await page\.getByLabel\('Banco\*'\)\.selectOption\(randomBanco\)\.catch\(\(\)=>null\);/g, `try { await page.getByLabel('Banco*').selectOption(randomBanco, {timeout:3000}); } catch(e) { await page.getByLabel('Banco*').selectOption({index:1}).catch(()=>null); }`);
content = content.replace(/await page\.getByLabel\('Tipo de Cuenta\*'\)\.selectOption\(randomCuenta\)\.catch\(\(\)=>null\);/g, `try { await page.getByLabel('Tipo de Cuenta*').selectOption(randomCuenta, {timeout:3000}); } catch(e) { await page.getByLabel('Tipo de Cuenta*').selectOption({index:1}).catch(()=>null); }`);

// 3. Update Case 3.0 to include screenshots
const case30_old = `            const textoDropdown = await selector.innerText();
            expect(textoDropdown.includes('DL')).toBe(false);`;
const case30_new = `            const textoDropdown = await selector.innerText();
            
            if (allure && allure.attachment) {
                try {
                    await selector.click();
                    await sharedPage.waitForTimeout(500);
                    const buffer = await sharedPage.screenshot({ fullPage: true });
                    allure.attachment("📸 Evidencia Dropdown Documentos (Sin DL)", buffer, "image/png");
                    await sharedPage.mouse.click(0, 0); 
                } catch(e) {}
            }
            
            expect(textoDropdown.includes('DL')).toBe(false);`;
content = content.replace(case30_old, case30_new);

// 4. Inject checkSystemDefect in all negative tests
content = content.replace(/(const r = await attachEvidence\('([^']+)', sharedPage, [^)]+\);\s*)(expect\(r\.isBotonBloqueado \|\| r\.errorVisualExtraido\.length > 0\)\.toBe\(true\);)/g, `$1checkSystemDefect(sharedPage, r, '$2');\n            $3`);

console.log(content.includes('checkSystemDefect(') ? "Patch includes function call" : "Patch failed to include function call");

fs.writeFileSync('tests/payout/e2e_ui/payout_merchant_EC_interactivity.test.js', content, 'utf8');
