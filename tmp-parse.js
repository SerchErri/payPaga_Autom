const fs = require('fs');
const path = require('path');

const resultsDir = path.join(__dirname, 'allure-results');
if (!fs.existsSync(resultsDir)) {
    console.log("# Error\nNo hay resultados de Allure disponibles. Corre los tests primero.");
    process.exit(0);
}

const files = fs.readdirSync(resultsDir);
const resultFiles = files.filter(f => f.endsWith('-result.json'));

let markdown = "# 🗒️ Reporte de Evidencia QA (Extraído de Allure)\n\n" +
               "Este reporte contiene tanto los defect-logs (para los desarrolladores) como las validaciones exitosas de negocio (para el Product Owner en JIRA).\n\n";

// Separamos en arrays para dar orden visual (Fallidos primero, Pasados después)
const failedTests = [];
const passedTests = [];

resultFiles.forEach(file => {
    try {
        const raw = fs.readFileSync(path.join(resultsDir, file), 'utf8');
        const data = JSON.parse(raw);
        
        // Excluimos setups u hooks vacíos
        if (!data.name || data.name.includes('"before all"')) return;

        let testBlock = "";
        const isFailed = data.status === 'failed' || data.status === 'broken';
        const statusEmoji = isFailed ? "🛑 **FALLÓ (Defecto / Rechazado)**" : "✅ **PASÓ (Validado / OK)**";
        
        testBlock += `### ${statusEmoji} | ${data.name}\n\n`;
        
        if (isFailed && data.statusDetails && data.statusDetails.message) {
            testBlock += `> [!WARNING]\n> **Error Expected vs Received:**\n> \`${data.statusDetails.message.split('\n')[0]}\`\n\n`;
        }

        if (data.attachments && data.attachments.length > 0) {
            data.attachments.forEach(att => {
                const attPath = path.join(resultsDir, att.source);
                if (fs.existsSync(attPath)) {
                    let content = fs.readFileSync(attPath, 'utf8');
                    // Recortamos respuestas muy gigantes a lo esencial si pesan mucho, aunque json formateado es mejor
                    try {
                        const parsed = JSON.parse(content);
                        content = JSON.stringify(parsed, null, 2);
                    } catch(e) {} // Si no es json puro (es texto plano) se deja igual
                    
                    testBlock += `<details><summary><b>📎 Ver ${att.name}</b></summary>\n\n\`\`\`json\n${content}\n\`\`\`\n</details>\n\n`;
                }
            });
        }
        testBlock += `---\n\n`;

        if (isFailed) failedTests.push(testBlock);
        else passedTests.push(testBlock);

    } catch (e) {}
});

markdown += "## ❌ Pruebas con Comportamiento Inesperado (Fallidos)\n\n";
markdown += failedTests.length > 0 ? failedTests.join('') : "¡No hay defectos reportados!\n\n";

markdown += "## 🟢 Pruebas Validadas Exitosamente (Casos Felices para JIRA)\n\n";
markdown += passedTests.length > 0 ? passedTests.join('') : "No hay casos exitosos.\n\n";

const outPath = path.join(__dirname, 'evidence-report.md');
fs.writeFileSync(outPath, markdown);
console.log(outPath);
