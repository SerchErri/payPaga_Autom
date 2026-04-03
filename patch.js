const fs = require('fs');

const path = 'tests/payin/e2e_ui/payurl_EC_interactivity.test.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Modificar attemptSubmit para sacar el pre-submit automáticamente
content = content.replace(
    /const attemptSubmit = async \(page\) => {/,
    `const attemptSubmit = async (page) => {
        if (allure && allure.attachment) {
            try {
                await page.waitForTimeout(500);
                const buffer = await page.screenshot({ fullPage: true });
                allure.attachment(\`📸 Formulario Lleno (Antes de Submit)\`, buffer, "image/png");
            } catch(e) {}
        }`
);

// 2. Modificar el Test 3.4 (Patrón 13 caracteres de Pasaporte)
const test34Old = `        test('3.4. Pasaporte PP: Pasa Límite de Frontera Alfanumérica (Ej: 13 correctos)', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await page.selectOption('#document_type', 'PP');
            const limitePermitido = 'A1B2C3D4E5QW9'; 
            await typeSafe(page, '#document_number', limitePermitido); 
            const r = await attachEvidence('PP - Boundary Máximo Soportado', page, \`PP: \${limitePermitido}\`, url);
            expect(r.isBotonBloqueado).toBe(false);
            await context.close();
        });`;

const test34New = `        test('3.4. Pasaporte PP: Pasa Límite de Frontera Alfanumérica (Ej: 13 correctos)', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await page.selectOption('#document_type', 'PP');
            const limitePermitido = 'A1B2C3D4E5QW9'; 
            await typeSafe(page, '#document_number', limitePermitido); 
            
            if (allure && allure.attachment) {
                await page.waitForTimeout(500);
                allure.attachment(\`📸 Formulario Lleno (Antes de Submit)\`, await page.screenshot({ fullPage: true }), "image/png");
            }

            const btn = page.locator('#submit_payment');
            const isBlocked = await btn.isDisabled().catch(()=>true);
            expect(isBlocked).toBe(false); // Debe estar habilitado para 13 chars
            
            // Hacer Click Real (No Forzado) ya que es Happy Path parcial
            await btn.click();
            await page.waitForTimeout(3000); // Esperar que cargue el Partner Checkout Modal
            
            await attachEvidence('PP - Checkout de Partner Abierto', page, \`PP: \${limitePermitido}\`, url);
            await context.close();
        });`;

content = content.replace(test34Old, test34New);

// 3. Opcionalmente arreglar Test 1.5 y 2.5 que también son Happy Paths si lo estaban
const test15Old = `        test('1.5. First Name: Pasa Regex Frontera (Apóstrofe y Rango de Mediana)', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#first_name', "O'Connor"); 
            const rounded = await attachEvidence('FN - Apóstrofes y Feliz', page, "First Name: 'O'Connor'", url);
            // El assert es Rojo si la prueba detectó que el botón NO se activó (es un bug del Frontend)
            expect(rounded.isBotonBloqueado).toBe(false); 
            await context.close();
        });`;

const test15New = `        test('1.5. First Name: Pasa Regex Frontera (Apóstrofe y Rango de Mediana)', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#first_name', "O'Connor"); 
            
            if (allure && allure.attachment) {
                await page.waitForTimeout(500);
                allure.attachment(\`📸 Formulario Lleno (Antes de Submit)\`, await page.screenshot({ fullPage: true }), "image/png");
            }
            
            // Clic real
            await page.locator('#submit_payment').click();
            await page.waitForTimeout(3000);

            const rounded = await attachEvidence('FN - Apóstrofes y Feliz', page, "First Name: 'O'Connor'", url);
            expect(rounded.isBotonBloqueado).toBe(false); 
            await context.close();
        });`;

content = content.replace(test15Old, test15New);

const test25Old = `        test('2.5. Last Name: Pasa Regex Frontera (Guiones)', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#last_name', "Torres-Gomez"); 
            const rounded = await attachEvidence('LN - Guion Valido', page, "Last Name: 'Torres-Gomez'", url);
            expect(rounded.isBotonBloqueado).toBe(false);
            await context.close();
        });`;

const test25New = `        test('2.5. Last Name: Pasa Regex Frontera (Guiones)', async () => {
            const { url, page, context } = await generarYPrepararCheckout();
            await fillBaseForm(page);
            await typeSafe(page, '#last_name', "Torres-Gomez"); 
            
            if (allure && allure.attachment) {
                await page.waitForTimeout(500);
                allure.attachment(\`📸 Formulario Lleno (Antes de Submit)\`, await page.screenshot({ fullPage: true }), "image/png");
            }
            
            // Clic real
            await page.locator('#submit_payment').click();
            await page.waitForTimeout(3000);

            const rounded = await attachEvidence('LN - Guion Valido', page, "Last Name: 'Torres-Gomez'", url);
            expect(rounded.isBotonBloqueado).toBe(false);
            await context.close();
        });`;

content = content.replace(test25Old, test25New);

fs.writeFileSync(path, content, 'utf8');
console.log('Patch Applied Successfully!');
