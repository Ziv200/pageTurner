// Copies the UNCHANGED PageTurner server (../server.js, ../composer-api.js, ../public) into desktop/server/
// so the app runs exactly the same code as `node server.js`, and builds the sample project.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..'), out = path.join(__dirname, '..', 'server');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
for (const f of ['server.js', 'composer-api.js']) fs.copyFileSync(path.join(root, f), path.join(out, f));
fs.cpSync(path.join(root, 'public'), path.join(out, 'public'), { recursive: true, filter: s => !/\.pdf$/i.test(s) && !s.endsWith('.DS_Store') });
// pdf.js (/lib) is resolved from desktop/node_modules/pdfjs-dist by server.js
require('./make-sample').then(() => console.log('prepared server/ and sample project'));
