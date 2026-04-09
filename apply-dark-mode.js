const fs = require('fs');
const path = './allure-report/index.html';

try {
    if (fs.existsSync(path)) {
        let content = fs.readFileSync(path, 'utf8');
        // Inyectamos el script en el head para forzar el tema oscuro nativo de Allure o un override CSS de emergencia
        const darkScript = `<script>
            // Forzar tema oscuro nativo si la versión de Allure lo soporta
            try { localStorage.setItem('allure2Settings', '{"theme":"dark"}'); } catch(e){}
        </script>
        <style>
            /* Override CSS puro como fallback para garantizar fondo oscuro puro */
            html, body { background-color: #121212 !important; color: #e0e0e0 !important; }
            .app { background-color: #121212 !important; }
            .pane__title, .pane__header { background-color: #1e1e1e !important; color: #fff !important; }
            .widget { background-color: #1e1e1e !important; box-shadow: 0 4px 6px rgba(0,0,0,0.3) !important; color: #fff !important;}
            .node__title { color: #ccc !important; }
            .step__title { color: #bbb !important; }
            /* Cajas de Error/StackTrace (Soluciona el problema de fondo rosa con letras blancas) */
            pre, .text-view, .status-details__trace, .test-result-status-details__trace, code { 
                background-color: #2c2c2c !important; 
                color: #ffb3b3 !important; 
                border: 1px solid #444 !important; 
                padding: 10px !important;
                border-radius: 4px !important;
                border-radius: 4px !important;
            }
            /* Sintaxis JSON super brillante (Colores vivos anti-ceguera para fondo calcín) */
            .hljs-attr { color: #f2cc60 !important; font-weight: bold !important; } /* Keys Amarillos Fuerte */
            .hljs-string { color: #7ee787 !important; } /* Strings Verdes Fluorescentes */
            .hljs-number { color: #ff7b72 !important; font-weight: bold !important; } /* Números Coral/Casi Rojizos */
            .hljs-literal, .hljs-keyword { color: #ff79c6 !important; font-weight: bold !important; } /* Booleans y Nulos en Fucsia brillante */
            .status-details { background-color: #1e1e1e !important; color: #e0e0e0 !important; }
            .test-result-status-details__message { background-color: #3a1c1c !important; color: #ff5252 !important; border-left: 4px solid #ff5252 !important; }
            /* Filtro para iconos y menús */
            .fa { color: #fff !important; }
            .side-nav { background-color: #000 !important; }
            a { color: #64b5f6 !important; }
            /* Filas de tabla con error en vez de rojo chillón o rosa pálido */
            .table__row_status_failed { background-color: #3a1c1c !important; color: #e0e0e0 !important; }
        </style>`;
        
        content = content.replace('<head>', `<head>${darkScript}`);
        fs.writeFileSync(path, content, 'utf8');
        console.log("🌙 Tema oscuro inyectado exitosamente en el reporte de Allure.");
    } else {
        console.log("No se pudo encontrar el reporte para inyectar modo oscuro.");
    }
} catch (error) {
    console.error("Error aplicando modo oscuro:", error);
}
