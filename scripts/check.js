// Vérifie la syntaxe de tous les fichiers JavaScript du projet.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
})(path.join(__dirname, '..', 'src'));
let bad = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { bad++; console.error('✗', f, '\n', e.stderr.toString()); }
}
console.log(bad ? `${bad} fichier(s) en erreur` : `✓ ${files.length} fichiers JavaScript valides`);
process.exit(bad ? 1 : 0);
