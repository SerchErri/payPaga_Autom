const fs = require('fs');
const html = fs.readFileSync('gt_error_dump_bam.html', 'utf8');
const msgs = html.match(/<span[^>]*error.*?<\/span>|<div[^>]*toast.*?<\/div>|<[^>]*invalid.*?/gi);
console.log(msgs ? msgs.slice(0, 5) : 'No error elements found');
