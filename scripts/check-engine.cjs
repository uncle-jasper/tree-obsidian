// packs.js is Tree's theme-pack engine, copied byte for byte (PACKS-PLAN.md: one engine, never
// hand-kept copies). When Tree sits next to this repo, the build stops if the copy has drifted.
const fs = require('fs'), path = require('path');
const tree = path.join(__dirname, '..', '..', 'tree', 'packs.js');
const mine = path.join(__dirname, '..', 'src', 'packs.js');
if (!fs.existsSync(tree)) { console.log('packs.js: ../tree not here, not compared'); return; }
if (fs.readFileSync(tree, 'utf8') !== fs.readFileSync(mine, 'utf8')) {
  console.error('src/packs.js differs from ../tree/packs.js. Copy it over: cp ../tree/packs.js src/packs.js');
  process.exit(1);
}
console.log('packs.js matches Tree');
