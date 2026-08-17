#!/usr/bin/env node
/**
 * Génère regroupements_departements.csv depuis data/communes.json
 *
 * Logique :
 *   - 249 communes max par département (matche LIMIT_PER_DEP dans generate.js)
 *   - 1000 communes max par "groupe"
 *   - Outre-mer (971+) exclu
 *   - Corse : code 20 (fusion 2A+2B déjà appliquée en BDD)
 *   - Pass 1 : dépts pleins (>= 249) → 4 par groupe dans l'ordre des codes
 *     (reliquat < 4 basculé dans pass 2)
 *   - Pass 2 : dépts partiels → Best-Fit-Decreasing
 *   - Aucun département splitté entre 2 groupes (unité atomique)
 *
 * Sortie : regroupements_departements.csv (séparateur `;`, sans accents)
 *
 * Usage : node generate-regroupements.js [--dry-run]
 */

const fs   = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry-run');
const CAP_PER_DEPT     = 249;
const TARGET_PER_GROUP = 1000;
const OUTFILE = path.join(__dirname, 'regroupements_departements.csv');

const ROOT_PARENT = path.resolve(__dirname, '..');
const communes = JSON.parse(fs.readFileSync(path.join(ROOT_PARENT, 'data', 'communes.json'), 'utf8'));

function normalizeDeptName(name) {
  return String(name)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['']/g, '-');
}

// ─── Comptage par dept ────────────────────────────────────────────────────────
const counts = new Map();
communes.forEach(c => {
  let code = String(c.dep_code).toUpperCase();
  if (code === '2A' || code === '2B') code = '20';
  if (code.length >= 3) return; // exclut outre-mer
  code = code.padStart(2, '0');
  const depNom = normalizeDeptName(c.dep_nom);
  if (!counts.has(code)) counts.set(code, { count: 0, depNom });
  counts.get(code).count++;
});

const rows = [...counts.entries()]
  .map(([depCode, v]) => ({ depCode, depNom: v.depNom, n: Math.min(v.count, CAP_PER_DEPT) }))
  .sort((a, b) => a.depCode.localeCompare(b.depCode));

const fullDepts    = rows.filter(r => r.n >= CAP_PER_DEPT);
const partialDepts = rows.filter(r => r.n <  CAP_PER_DEPT);

// ─── Packing en groupes de 1000 ───────────────────────────────────────────────
const groups = [];

// Pass 1 — groupes complets de 4 dépts pleins uniquement
const fullComplete = Math.floor(fullDepts.length / 4) * 4;
for (let i = 0; i < fullComplete; i += 4) {
  groups.push(fullDepts.slice(i, i + 4));
}
const leftoverFulls = fullDepts.slice(fullComplete);

// Pass 2 — Best-Fit-Decreasing sur partiels + reliquat
const partialBins = [];
const sortedPartials = [...partialDepts, ...leftoverFulls].sort((a, b) => b.n - a.n);
sortedPartials.forEach(d => {
  let bestBin = null, bestRemaining = Infinity;
  partialBins.forEach(b => {
    const remaining = TARGET_PER_GROUP - b.total;
    if (d.n <= remaining && remaining < bestRemaining) {
      bestBin = b;
      bestRemaining = remaining;
    }
  });
  if (!bestBin) {
    bestBin = { items: [], total: 0 };
    partialBins.push(bestBin);
  }
  bestBin.items.push(d);
  bestBin.total += d.n;
});

partialBins
  .sort((a, b) => b.total - a.total)
  .forEach(b => {
    b.items.sort((a, b) => a.depCode.localeCompare(b.depCode));
    groups.push(b.items);
  });

// ─── Génération CSV ───────────────────────────────────────────────────────────
const header = 'Groupe;Code dept;Nom dept;Nb communes;Total groupe;Marge groupe';
const lines = [header];
groups.forEach((grp, idx) => {
  const groupId = idx + 1;
  const total   = grp.reduce((s, d) => s + d.n, 0);
  const marge   = TARGET_PER_GROUP - total;
  grp.forEach(d => {
    lines.push(`${groupId};${d.depCode};${d.depNom};${d.n};${total};${marge}`);
  });
});
const csv = lines.join('\n') + '\n';

// ─── Récap console ────────────────────────────────────────────────────────────
console.log('');
console.log(`📊  ${rows.length} départements (outre-mer exclu)`);
console.log(`     Dépts pleins (>= ${CAP_PER_DEPT}) : ${fullDepts.length}`);
console.log(`     Dépts partiels (<  ${CAP_PER_DEPT}) : ${partialDepts.length}`);
console.log(`     Total communes capées : ${rows.reduce((s, r) => s + r.n, 0)}`);
console.log('');
console.log(`📦  ${groups.length} groupes générés (cible ${TARGET_PER_GROUP}/groupe)`);
groups.forEach((grp, i) => {
  const total = grp.reduce((s, d) => s + d.n, 0);
  console.log(`     Groupe ${(i + 1).toString().padStart(2)} : ${grp.length} dépts, ${total} communes (marge ${TARGET_PER_GROUP - total})`);
});

if (DRY) {
  console.log('\n🧪 --dry-run : aucune écriture');
  return;
}

fs.writeFileSync(OUTFILE, csv, 'utf8');
console.log(`\n✅ ${path.basename(OUTFILE)} écrit (${lines.length - 1} lignes + header)`);
