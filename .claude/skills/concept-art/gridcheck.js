// Concept-sheet lint: every candidate's down/up/side grids are 16 wide, share one
// height, and the front/back grids are mirror-symmetric. Usage:
//   node .claude/skills/concept-art/gridcheck.js docs/media/concepts/merchant-concepts-2.html
// It reads the `const X = { ... down: [...], up: [...], side: [...] }` blocks by text, so a
// sheet written from sheet-template.html needs no changes to be checked.
const fs = require('fs');
const file = process.argv[2];
if (!file) { console.error('usage: node gridcheck.js <sheet.html>'); process.exit(2); }
const s = fs.readFileSync(file, 'utf8').replace(/\/\/[^\n]*/g, '');
let bad = 0;
for (const m of s.matchAll(/const ([A-Z]) = \{/g)) {
  const v = m[1], i0 = m.index;
  const end = s.indexOf('\n};', i0);
  const heights = new Set();
  for (const k of ['down', 'up', 'side']) {
    const j0 = s.indexOf(k + ': [', i0);
    if (j0 < 0 || j0 > end) { console.log(v, k, 'missing'); bad++; continue; }
    const j1 = s.indexOf('],', j0);
    const rows = [...s.slice(j0, j1).matchAll(/'([^']*)'/g)].map((x) => x[1]);
    heights.add(rows.length);
    rows.forEach((r, i) => { if (r.length !== 16) { bad++; console.log(v, k, 'row', i, 'width', r.length, r); } });
    if (k !== 'side') rows.forEach((r, i) => { if (r !== r.split('').reverse().join('')) { bad++; console.log(v, k, 'row', i, 'not mirror-symmetric', r); } });
  }
  if (heights.size > 1) { bad++; console.log(v, 'heights differ', [...heights].join('/')); }
  console.log(v, 'checked, height', [...heights][0]);
}
console.log(bad ? bad + ' problem(s)' : 'all good');
process.exit(bad ? 1 : 0);
