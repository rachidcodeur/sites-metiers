#!/usr/bin/env node
/**
 * Générateur du site départemental — métier peintre.
 *
 *   node generate-dep.js --dep 33 --dep-nom Gironde --domain peintre-gironde-33.fr
 *
 * Même template que les communes : le département y tient le rôle de la ville
 * ({{VILLE}} = « Gironde », {{VILLE_A}} = « en Gironde »). Un seul design pour
 * tout le réseau, et donc un seul fichier à maintenir — c'est la leçon tirée du
 * couvreur, où deux templates séparés avaient silencieusement divergé.
 *
 * Sortie : output/{DEP}-{slug-dep}-dep/ + assets/ mutualisés à la racine.
 */
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const T = require('./template-assets.js');
const { getDepFormes } = require('../../_shared/dep-formes.js');

const DIR        = __dirname;
const METIER_DIR = path.resolve(DIR, '..');

function loadEnv(fp) {
  if (!fs.existsSync(fp)) return {};
  return Object.fromEntries(
    fs.readFileSync(fp, 'utf8').split('\n')
      .filter(l => l.includes('=') && !l.trim().startsWith('#'))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
}
const ENV = loadEnv(path.join(METIER_DIR, '.env'));
// Forme attendue par script.js, qui lit le bloc <script id="supabase-config-json">
// et non un placeholder : ce template n'utilise pas {{SUPABASE_CONFIG_JSON}}.
const SUPABASE_JSON = JSON.stringify({
  directUrl: ENV.SUPABASE_URL || '',
  url:       ENV.SUPABASE_USE_RELATIVE_API === '1' ? '' : (ENV.SUPABASE_URL || ''),
  relative:  ENV.SUPABASE_USE_RELATIVE_API === '1',
  anon:      ENV.SUPABASE_ANON_KEY || '',
  table:     ENV.SUPABASE_TABLE_PEINTRE || 'leads_peinture',
});

/** Injecte la config Supabase dans le bloc JSON prévu par le template. */
function injecterSupabase(html) {
  return html.replace(
    /<script type="application\/json" id="supabase-config-json">[\s\S]*?<\/script>/,
    `<script type="application/json" id="supabase-config-json">${SUPABASE_JSON}</script>`
  );
}

const PHONE     = '09 80 40 96 11';
const PHONE_TEL = '+33980409611';

const args   = process.argv.slice(2);
const getArg = n => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : null; };

const depCode   = getArg('--dep');
const depNom    = getArg('--dep-nom');
const domainArg = (getArg('--domain') || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');

if (!depCode || !depNom || !domainArg) {
  console.error('Usage : node generate-dep.js --dep <code> --dep-nom <nom> --domain <domaine>');
  process.exit(1);
}

const slugify = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const communes  = JSON.parse(fs.readFileSync(path.join(METIER_DIR, 'data', 'communes.json'), 'utf8'));
const variables = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'variables.json'), 'utf8'));
const template  = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');

const normDep = String(depCode).replace(/^0+/, '');
const duDep = communes
  .filter(c => String(c.dep_code).replace(/^0+/, '') === normDep)
  .sort((a, b) => (parseInt(b.population, 10) || 0) - (parseInt(a.population, 10) || 0));

function pickVariant(arr, seed, cle) {
  if (!Array.isArray(arr) || !arr.length) return '';
  const h = crypto.createHash('sha256').update(seed + '::' + (cle || '')).digest();
  return arr[h.readUInt32BE(0) % arr.length];
}

const outputBase = path.join(DIR, 'output', `${depCode}-${slugify(depNom)}-dep`);
fs.mkdirSync(outputBase, { recursive: true });
T.writeSharedAssets(DIR, outputBase);

const formes = getDepFormes(depCode, depNom);
const seed   = `dep-${depCode}`;

const vars = {
  VILLE:       depNom,
  VILLE_A:     formes.a,
  CODE_POSTAL: String(depCode),
  DEP_NOM:     depNom,
  DEP_NOM_A:   formes.a,
  DEP_NOM_DE:  formes.de,
  DEP_NOM_LE:  formes.le,
  DEP_CODE:    String(depCode),
  REG_NOM:     (duDep[0] || {}).reg_nom || '',
  URL:         domainArg,
  MARQUE:      `Peintre ${depNom}`,
  PHONE, PHONE_TEL,
  PHONE_NBSP:  PHONE.replace(/ /g, '&nbsp;'),
  YEAR:        String(new Date().getFullYear()),
  SUPABASE_CONFIG_JSON: SUPABASE_JSON,
};

// Avis : villes tirées parmi les communes du département
const noms = variables._pool_noms_avis || ['Marc L.'];
for (let i = 1; i <= 10; i++) {
  vars[`AVIS_${i}_NOM`]   = pickVariant(noms, seed, 'avis_nom_' + i);
  vars[`AVIS_${i}_VILLE`] = pickVariant(duDep.map(c => c.nom_standard), seed, 'avis_ville_' + i);
}

for (const [cle, arr] of Object.entries(variables)) {
  if (!Array.isArray(arr) || cle.startsWith('_')) continue;
  vars[cle.toUpperCase()] = T.replace(pickVariant(arr, seed, cle), vars);
}

const aujourdhui = new Date().toISOString().slice(0, 10);

fs.writeFileSync(path.join(outputBase, 'index.html'),
  injecterSupabase(T.absolutizeAssets(T.replace(template, vars))), 'utf8');

fs.writeFileSync(path.join(outputBase, 'sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://${domainArg}/</loc><lastmod>${aujourdhui}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
</urlset>`, 'utf8');

fs.writeFileSync(path.join(outputBase, 'robots.txt'),
  `User-agent: *\nAllow: /\nSitemap: https://${domainArg}/sitemap.xml\n`, 'utf8');

console.log(`✅ site départemental — ${depNom} (${depCode})`);
console.log(`   https://${domainArg}/`);
