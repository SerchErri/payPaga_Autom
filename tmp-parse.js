const fs = require('fs');
const html = fs.readFileSync('gt_error_dump_bam.html', 'utf8');

// Busquemos cualquier texto que parezca un mensaje de error o toast
// Especialmente dentro de div#toast-container
const toastRegex = /<div id="toast-container"[^>]*>([\s\S]*?)<\/div>/i;
const toastMatch = toastRegex.exec(html);
console.log("Toast container content:", toastMatch ? toastMatch[1] : "Not found");

// Regex para spans de validación:
const valRegex = /<span class="[^"]*validation-error-message[^"]*"[^>]*>([^<]+)<\/span>/g;
let m;
while((m = valRegex.exec(html)) !== null) {
    if(m[1].trim()) console.log("Validation error:", m[1].trim());
}
