const fs = require('fs');
const html = fs.readFileSync('gt_error_dump_bam.html', 'utf8');
const curMatch = html.match(/<select id="currency"[\s\S]*?<\/select>/);
console.log(curMatch ? curMatch[0] : 'no currency select found');
