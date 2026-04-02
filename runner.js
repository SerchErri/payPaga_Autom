const { execSync } = require('child_process');

function parseArgs() {
    const args = process.argv.slice(2);
    const params = {};
    args.forEach(arg => {
        if (arg.startsWith('--')) {
            const [key, value] = arg.substring(2).split('=');
            if (key && value !== undefined) {
                params[key] = value;
            }
        }
    });
    return params;
}

const params = parseArgs();
const env = params.env || process.env.TEST_ENV || 'dev';

const regexTags = [];
if (params.module) regexTags.push(`(?=.*${params.module})`); // payin, payout
if (params.product) regexTags.push(`(?=.*${params.product})`); // payurl, merchant, h2h
if (params.country) regexTags.push(`(?=.*${params.country})`); // EC, PE
if (params.type) regexTags.push(`(?=.*${params.type})`); // interactivity, flow, api

const jestPattern = regexTags.length > 0 ? regexTags.join('') : '.';

const showReport = params.report === 'true';

// Pasamos las variables para que envConfig.js pueda tomarlas
const envCommand = `npx cross-env TEST_ENV=${env} ${params.country ? `COUNTRY=${params.country}` : ''}`;
const jestCommand = `npx jest "${jestPattern}" --verbose`;
const allureResults = `./allure-results`;
const allureReport = `./allure-report`;

console.log('====================================================');
console.log(`🚀 RUNNER MATRICIAL INICIADO`);
console.log(`🌍 Entorno   : ${env.toUpperCase()}`);
if (params.country) console.log(`🗺️  País      : ${params.country.toUpperCase()}`);
if (params.module)  console.log(`📦 Módulo    : ${params.module}`);
if (params.product) console.log(`🛒 Producto  : ${params.product}`);
if (params.type)    console.log(`🔍 Tipo Test : ${params.type}`);
console.log(`\n🎯 Regex de Búsqueda: "${jestPattern}"`);
console.log(`📊 Abrir Reporte UI: ${showReport ? 'SÍ' : 'NO'}`);
console.log('====================================================\n');

try {
    console.log('🧹 Limpiando reportes locales previos...');
    // Limpieza cruzada (Windows/Linux) usando require('fs') podría ser mejor, pero probemos comandos nativos
    try { execSync('if exist allure-results rmdir /s /q allure-results'); } catch(e){}
    try { execSync('if exist allure-report rmdir /s /q allure-report'); } catch(e){}
    
    console.log('⏳ Ejecutando Suite de Tests con Jest...');
    execSync(`${envCommand} ${jestCommand}`, { stdio: 'inherit' });

} catch (error) {
    console.error('\n❌ Algunos tests fallaron.');
} finally {
    if (showReport) {
        console.log('\n🎨 Generando reporte Allure Visual...');
        try {
            execSync(`allure generate ${allureResults} --clean -o ${allureReport}`, { stdio: 'inherit' });
            execSync(`node ./utils/applyDarkMode.js`, { stdio: 'inherit' });
            console.log('\n🌐 Levantando servidor local en puerto 5050...');
            execSync(`npx http-server ${allureReport} -p 5050 -c-1 -o`, { stdio: 'inherit' });
        } catch (e) {
            console.error('Error generando el reporte visual', e.message);
        }
    } else {
         console.log('\n📂 Reporte JSON generado en background. (Añade --report=true la próxima vez para visualizarlo en web).');
    }
}
