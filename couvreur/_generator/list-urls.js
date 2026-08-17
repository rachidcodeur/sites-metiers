#!/usr/bin/env node
/**
 * Enumère toutes les URLs des sites couvreur déployés et les répartit
 * en onglets selon le fichier de regroupement `regroupements_departements.csv`.
 *
 * Chaque onglet porte le nom des départements qui le composent, joints par tirets,
 * préfixé du numéro de groupe (ex: groupe 1 contenant 01, 02, 03, 07 → "01_01-02-03-07.csv").
 *
 * URLs construites (sans https://, format brut domaine + sitemap) :
 *   - Sous-domaine ville : {ville-slug}.couvreur{XX}-pro.fr
 *
 * Source des communes : json-communes/communes_XX.json (top 249 par pop) +
 *   complément automatique depuis data/communes.json si nécessaire.
 *
 * Sortie : 1 CSV par groupe dans output-urls/, 2 colonnes : URL ; Sitemap
 *
 * Usage : node list-urls.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT = __dirname;
const PARENT = path.resolve(ROOT, '..');
const LIMIT_PER_DEP = 249;
const SHEET_LIMIT  = 249;

const allCommunes = JSON.parse(fs.readFileSync(path.join(PARENT, 'data', 'communes.json'), 'utf8'));
const jsonDir = path.join(PARENT, 'json-communes');
const groupingFile = path.join(ROOT, 'regroupements_departements.csv');

function slugify(s) {
  return String(s).toLowerCase()
    .replace(/['']/g, '-').replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}
function dep2(c) {
  const s = String(c).toUpperCase();
  if (s === '2A' || s === '2B' || s.length >= 3) return s;
  return s.padStart(2, '0');
}
function normaliseName(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Index communes par nom + dep
const communeIndex = new Map();
allCommunes.forEach(c => {
  const k = normaliseName(c.nom_standard) + '_' + dep2(c.dep_code);
  communeIndex.set(k, c);
});

// Parse le fichier de regroupement : groupe → [dept codes]
if (!fs.existsSync(groupingFile)) {
  console.error(`❌ ${path.basename(groupingFile)} introuvable. Lance d'abord :`);
  console.error(`   node generate-regroupements.js`);
  process.exit(1);
}
const groups = new Map();
fs.readFileSync(groupingFile, 'utf8').split('\n').slice(1).forEach(line => {
  const trimmed = line.trim();
  if (!trimmed) return;
  const [groupe, depCode] = trimmed.split(';');
  if (!groupe || !depCode) return;
  const padded = dep2(depCode);
  if (!groups.has(groupe)) groups.set(groupe, []);
  groups.get(groupe).push(padded);
});

// Pour chaque dept, charge la liste de communes (top LIMIT_PER_DEP, avec complément)
function loadDeptCommunes(padded) {
  const file = path.join(jsonDir, `communes_${padded}.json`);
  if (!fs.existsSync(file)) return [];
  let payload;
  try { payload = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return []; }

  const list = [];
  const have = new Set();
  if (Array.isArray(payload)) {
    payload.slice(0, LIMIT_PER_DEP).forEach(c => {
      const indexed = communeIndex.get(normaliseName(c.nom_standard) + '_' + dep2(c.dep_code));
      const commune = indexed || c;
      list.push(commune);
      if (indexed) have.add(indexed);
    });
  } else if (Array.isArray(payload.villes)) {
    payload.villes.slice(0, LIMIT_PER_DEP).forEach(v => {
      let c = communeIndex.get(normaliseName(v) + '_' + padded);
      if (!c && (padded === '20' || padded === '2A' || padded === '2B')) {
        c = communeIndex.get(normaliseName(v) + '_2A') || communeIndex.get(normaliseName(v) + '_2B');
      }
      if (c) { list.push(c); have.add(c); }
    });
  }
  // Complément top-pop
  if (list.length < LIMIT_PER_DEP) {
    const matchDep = padded === '20' ? ['20', '2A', '2B'] : [padded.replace(/^0+/, '') || padded];
    const extras = allCommunes
      .filter(c => matchDep.includes(String(c.dep_code).toUpperCase().replace(/^0+/, '')))
      .filter(c => !have.has(c))
      .sort((a, b) => (parseInt(b.population, 10) || 0) - (parseInt(a.population, 10) || 0))
      .slice(0, LIMIT_PER_DEP - list.length);
    extras.forEach(c => list.push(c));
  }
  return list;
}

function urlsForDept(depCode, communes) {
  // Sites villes uniquement (sous-domaines) — pas les sites dépt principaux
  // Format domaine brut, SANS https://
  return communes.map(c => {
    const slug = slugify(c.nom_sans_accent);
    return `${slug}.couvreur${dep2(c.dep_code)}-pro.fr`;
  });
}

// Construit les onglets selon les groupes — clé "NN_codes" pour tri Apps Script
const tabs = {};
const sortedGroups = Array.from(groups.keys()).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
const removedFromSheet = {};
sortedGroups.forEach(g => {
  const depts = groups.get(g);
  const groupNum = String(g).padStart(2, '0');
  const tabName = `${groupNum}_${depts.join('-')}`;
  const urls = [];
  depts.forEach(d => {
    const communes = loadDeptCommunes(d);
    if (communes.length > SHEET_LIMIT) {
      const dropped = communes[SHEET_LIMIT];
      removedFromSheet[d] = {
        nom: dropped.nom_standard,
        slug: slugify(dropped.nom_sans_accent),
        url: `${slugify(dropped.nom_sans_accent)}.couvreur${d}-pro.fr`,
        position: SHEET_LIMIT + 1,
        population: dropped.population || '',
      };
    }
    const kept = communes.slice(0, SHEET_LIMIT);
    urls.push(...urlsForDept(d, kept));
  });
  tabs[tabName] = urls;
});

// Enregistre la liste des communes retirées (toujours déployées en prod)
const removedPath = path.join(ROOT, 'communes-retirees-sheet.json');
fs.writeFileSync(removedPath, JSON.stringify(removedFromSheet, null, 2), 'utf8');

// Purge anciens CSVs puis écrit les nouveaux
const outDir = path.join(ROOT, 'output-urls');
fs.mkdirSync(outDir, { recursive: true });
fs.readdirSync(outDir).filter(f => f.endsWith('.csv')).forEach(f => fs.unlinkSync(path.join(outDir, f)));

console.log('');
Object.entries(tabs).forEach(([name, urls]) => {
  // 2 colonnes : URL du site (sous-domaine brut) ; URL du sitemap
  const lines = ['URL;Sitemap'];
  urls.forEach(u => lines.push(`${u};${u}/sitemap.xml`));
  fs.writeFileSync(path.join(outDir, `${name}.csv`), lines.join('\n'), 'utf8');
  console.log(`✓  ${name.padEnd(36)} ${String(urls.length).padStart(5)} URLs`);
});

const totalUrls = Object.values(tabs).reduce((a, b) => a + b.length, 0);
console.log(`\n📊  Total : ${totalUrls} URLs · ${Object.keys(tabs).length} onglets · ${outDir}/`);
const removedCount = Object.keys(removedFromSheet).length;
if (removedCount) {
  console.log(`🗂️   ${removedCount} commune(s) retirée(s) du sheet (toujours déployées en prod)`);
  console.log(`     → liste complète dans ${path.relative(PARENT, removedPath)}`);
}
