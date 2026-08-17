#!/usr/bin/env node
/**
 * Générateur des sites communes — métier peintre.
 *
 *   node generate.js --dep 33 --dep-nom Gironde --domain peintre-gironde-33.fr
 *   node generate.js --dep 33 --dep-nom Gironde --mode domaine
 *
 * Deux schémas d'URL,选 par --mode :
 *   sousdomaine (défaut) : {commune}.{--domain}          ex. biganos.peintre-gironde-33.fr
 *   domaine              : peintre-en-batiment-{commune}.fr
 *
 * Sortie : output/{DEP}-{slug-dep}/{commune}/  + assets/ mutualisés à la racine.
 * Les chemins d'assets sont réécrits en absolu /assets/… — voir §7 de la doc.
 */
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const T = require('./template-assets.js');
const { getDepFormes } = require('../../_shared/dep-formes.js');

const DIR         = __dirname;
const METIER_DIR  = path.resolve(DIR, '..');

// ─── .env (Supabase) ─────────────────────────────────────────────────────────
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

// ─── Identité du réseau ──────────────────────────────────────────────────────
const PHONE     = '09 80 40 96 11';
const PHONE_TEL = '+33980409611';

// ─── Arguments ───────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const getArg = n => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : null; };

const depCode  = getArg('--dep');
const depNom   = getArg('--dep-nom');
const domainArg = (getArg('--domain') || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
const MODE     = getArg('--mode') || 'sousdomaine';   // sousdomaine | domaine
const LIMITE   = parseInt(getArg('--limite') || '249', 10);

if (!depCode || !depNom) {
  console.error('Usage : node generate.js --dep <code> --dep-nom <nom> [--domain <d>] [--mode sousdomaine|domaine]');
  process.exit(1);
}
if (MODE === 'sousdomaine' && !domainArg) {
  console.error('❌ --domain est requis en mode sousdomaine.');
  process.exit(1);
}

const slugify = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ─── Données ─────────────────────────────────────────────────────────────────
const communes  = JSON.parse(fs.readFileSync(path.join(METIER_DIR, 'data', 'communes.json'), 'utf8'));
const variables = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'variables.json'), 'utf8'));
const template  = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');

const normDep = String(depCode).replace(/^0+/, '');
const retenues = communes
  .filter(c => String(c.dep_code).replace(/^0+/, '') === normDep)
  .sort((a, b) => (parseInt(b.population, 10) || 0) - (parseInt(a.population, 10) || 0))
  .slice(0, LIMITE);

if (!retenues.length) {
  console.error(`❌ Aucune commune trouvée pour le département ${depCode}.`);
  process.exit(1);
}

// ─── Variantes ───────────────────────────────────────────────────────────────
function pickVariant(arr, seed, cle) {
  if (!Array.isArray(arr) || !arr.length) return '';
  const h = crypto.createHash('sha256').update(seed + '::' + (cle || '')).digest();
  return arr[h.readUInt32BE(0) % arr.length];
}

/** L'URL publique d'une commune, selon le schéma retenu. */
function urlDe(commune) {
  const s = slugify(commune.nom_sans_accent || commune.nom_standard);
  return MODE === 'domaine' ? `peintre-en-batiment-${s}.fr` : `${s}.${domainArg}`;
}

// ─── Génération ──────────────────────────────────────────────────────────────
const outDir     = `${depCode}-${slugify(depNom)}`;
const outputBase = path.join(DIR, 'output', outDir);
fs.mkdirSync(outputBase, { recursive: true });
T.writeSharedAssets(DIR, outputBase);

const formes = getDepFormes(depCode, depNom);
const aujourdhui = new Date().toISOString().slice(0, 10);
let faits = 0;

for (const commune of retenues) {
  const slug = slugify(commune.nom_sans_accent || commune.nom_standard);
  const url  = urlDe(commune);
  const cp   = String(commune.code_postal).padStart(5, '0');

  const vars = {
    VILLE:       commune.nom_standard,
    VILLE_A:     commune.nom_a || `à ${commune.nom_standard}`,
    CODE_POSTAL: cp,
    DEP_NOM:     depNom,
    DEP_NOM_A:   formes.a,
    DEP_NOM_DE:  formes.de,
    DEP_NOM_LE:  formes.le,
    DEP_CODE:    String(depCode),
    REG_NOM:     commune.reg_nom || '',
    URL:         url,
    MARQUE:      `Peintre ${commune.nom_standard}`,
    PHONE, PHONE_TEL,
    PHONE_NBSP:  PHONE.replace(/ /g, '&nbsp;'),
    YEAR:        String(new Date().getFullYear()),
    SUPABASE_CONFIG_JSON: SUPABASE_JSON,
  };

  // 10 avis : nom tiré du réservoir, ville tirée des communes du département.
  // Déterministe par commune, donc stable d'un build à l'autre.
  const noms = variables._pool_noms_avis || ['Marc L.'];
  for (let i = 1; i <= 10; i++) {
    vars[`AVIS_${i}_NOM`]   = pickVariant(noms, slug, 'avis_nom_' + i);
    vars[`AVIS_${i}_VILLE`] = pickVariant(retenues.map(c => c.nom_standard), slug, 'avis_ville_' + i);
  }

  // Slots de texte : 5 variantes chacun, avec substitution des {VAR} imbriquées
  for (const [cle, arr] of Object.entries(variables)) {
    if (!Array.isArray(arr) || cle.startsWith('_')) continue;
    vars[cle.toUpperCase()] = T.replace(pickVariant(arr, slug, cle), vars);
  }

  const outPath = path.join(outputBase, slug);
  fs.mkdirSync(outPath, { recursive: true });

  fs.writeFileSync(path.join(outPath, 'index.html'),
    injecterSupabase(T.absolutizeAssets(T.replace(template, vars))), 'utf8');

  fs.writeFileSync(path.join(outPath, 'sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://${url}/</loc><lastmod>${aujourdhui}</lastmod><changefreq>monthly</changefreq><priority>1.0</priority></url>
</urlset>`, 'utf8');

  fs.writeFileSync(path.join(outPath, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: https://${url}/sitemap.xml\n`, 'utf8');

  faits++;
}

console.log(`✅ ${faits} commune(s) générée(s) — ${outDir}`);
console.log(`   mode : ${MODE}${MODE === 'sousdomaine' ? ` (${domainArg})` : ' (un domaine par commune)'}`);
console.log(`   exemple : https://${urlDe(retenues[0])}/`);
