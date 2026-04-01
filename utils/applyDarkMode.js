const fs = require('fs');
const path = require('path');

// Buscamos el archivo de estilos que acaba de generar Allure
const cssPath = path.join(__dirname, '../allure-report/styles.css');

if (fs.existsSync(cssPath)) {
    // Truco CSS de alto nivel: Invertimos todos los colores de la UI (blanco a negro)
    // Pero rotamos los tonos 180 grados para que el Rojo siga siendo rojo (errores) 
    // y el verde siga siendo verde (éxitos).
    const darkCSS = `
    /* === INYECCIÓN DE MODO OSCURO AUTOMATIZADO === */
    html { 
        filter: invert(1) hue-rotate(180deg); 
        background-color: #111; 
    }
    img, video, iframe, .chart, .allure-logo { 
        /* Prevenimos que las imágenes o logos se inviertan a negativo */
        filter: invert(1) hue-rotate(180deg); 
    }
    body {
        background-color: #fff; /* Al invertirse será casi negro absoluto */
    }
    `;

    fs.appendFileSync(cssPath, darkCSS);
    console.log('✅ Modo Oscuro inyectado exitosamente en el reporte de Allure.');
} else {
    console.log('⚠️ No se encontró styles.css. Asegúrate de ejecutar el script después de "allure generate".');
}
