const fs = require('fs');
const html = fs.readFileSync('gt_error_dump_bam.html', 'utf8');
const model = html.match(/<script id=\"payment_link_model\" type=\"application\/json\">([\s\S]*?)<\/script>/)[1];

const data = JSON.parse(model);
console.log(JSON.stringify(data.countries.filter(c => ['GT','CO'].includes(c.id)), null, 2));
