const fs = require('fs');
const path = require('path');

const REPORT_DIR = path.join(__dirname, 'allure-report', 'data');
const TEST_CASES_DIR = path.join(REPORT_DIR, 'test-cases');
const ATTACHMENTS_DIR = path.join(REPORT_DIR, 'attachments');
const OUTPUT_DIR = path.join(__dirname, '_evidencias_jira');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

console.log(`\n==========================================================`);
console.log(`🚀 EXPORTADOR DE EVIDENCIAS ALLURE PARA JIRA`);
console.log(`==========================================================\n`);

try {
    if (!fs.existsSync(TEST_CASES_DIR)) {
        console.error("❌ No se encontró la carpeta allure-report. Asegúrate de ejecutar 'npx allure generate' primero.");
        process.exit(1);
    }

    const testFiles = fs.readdirSync(TEST_CASES_DIR).filter(f => f.endsWith('.json'));
    let totalImages = 0;

    for (const file of testFiles) {
        const rawData = fs.readFileSync(path.join(TEST_CASES_DIR, file), 'utf8');
        const testCase = JSON.parse(rawData);

        // Nombre limpio del Test Case (removiendo caracteres inválidos para Windows)
        // Por lo general usamos el "name" o el primer componente de la suite
        const cleanTestName = testCase.name.replace(/[<>:"/\\|?*]/g, '').trim();
        const testOutputDir = path.join(OUTPUT_DIR, cleanTestName);

        // Extraer todos los attachments de los steps recursivamente
        let imageAttachments = [];
        
        const extractAttachments = (steps) => {
            if (!steps) return;
            for (const step of steps) {
                if (step.attachments) {
                    const imgs = step.attachments.filter(a => a.type.includes('image'));
                    imageAttachments.push(...imgs);
                }
                if (step.steps) extractAttachments(step.steps);
            }
        };

        // Extraer del nivel raíz
        if (testCase.attachments) {
            imageAttachments.push(...testCase.attachments.filter(a => a.type.includes('image')));
        }
        // Extraer de todos los steps interiores
        extractAttachments(testCase.testStage?.steps);

        if (imageAttachments.length > 0) {
            if (!fs.existsSync(testOutputDir)) fs.mkdirSync(testOutputDir, { recursive: true });
            
            console.log(`📁 Test: ${cleanTestName}`);
            
            imageAttachments.forEach((attachment, index) => {
                const sourcePath = path.join(ATTACHMENTS_DIR, attachment.source);
                
                // Nombre legible de la evidencia + Numero para orden secuencial
                const cleanImageName = attachment.name ? attachment.name.replace(/[<>:"/\\|?*]/g, '').trim() : `Evidencia_Visual_Desconocida`;
                const finalFileName = `${index + 1}_${cleanImageName}.png`;
                const destPath = path.join(testOutputDir, finalFileName);

                if (fs.existsSync(sourcePath)) {
                    fs.copyFileSync(sourcePath, destPath);
                    console.log(`   ✔️  Copiado: ${finalFileName}`);
                    totalImages++;
                } else {
                    console.log(`   ❌  Falta el archivo: ${attachment.source}`);
                }
            });
            console.log(); // Salto de línea
        }
    }

    console.log(`✅ ¡Proceso Terminado! Se exportaron un total de ${totalImages} imágenes listas para Jira.`);
    console.log(`📂 Las encontrarás en la carpeta: ${OUTPUT_DIR}\n`);

} catch (error) {
    console.error("Error crítico procesando evidencias:", error);
}
