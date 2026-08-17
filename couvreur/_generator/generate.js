#!/usr/bin/env node
/**
 * Générateur de sites peintres par commune
 * Usage : node generate.js --dep 33 --dir Gironde [--depdir output/gironde-dep]
 *
 * --depdir  (optionnel) : dossier du site département déjà généré.
 *           Après la génération, le sitemap.xml de ce dossier est mis à jour
 *           avec les URLs de tous les sous-domaines villes générés.
 *
 * Structure des images sources attendue :
 *   public/images/villes/{slug}/hero.webp
 *   public/images/villes/{slug}/peinture-interieur.webp
 *   public/images/villes/{slug}/peinture-exterieur.webp
 *   public/images/villes/{slug}/pose-papier-peint.webp
 * Si un fichier ville est absent, le fichier par défaut du template est utilisé.
 *
 * Téléphone : champ "tel" dans communes.json (ex: "05 56 XX XX XX").
 * Si absent, la constante TEL_DEFAULT est utilisée.
 */

const fs   = require('fs');
const path = require('path');

// ─── Lecture du .env ─────────────────────────────────────────────────────────

function loadEnv(filePath = '.env') {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  fs.readFileSync(filePath, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  });
  return env;
}

// Charge prioritairement le .env racine du projet, puis surcharge avec un .env local éventuel.
const ENV = { ...loadEnv(path.resolve(__dirname, '..', '.env')), ...loadEnv('.env') };

// ─── Config ──────────────────────────────────────────────────────────────────

// Téléphone par défaut si non renseigné dans communes.json
const TEL_DEFAULT      = '09 80 40 96 11';
const TEL_HREF_DEFAULT = '+33980409611';

// Assets mutualisés — voir PROJET-O2SWITCH.md §7.
// Sur o2switch les 250 communes d'un département sont servies par UN SEUL vhost
// wildcard : leur document root commun est la racine de cette sortie. Les assets
// partagés y sont donc écrits une seule fois, et le HTML les référence en chemin
// ABSOLU (/assets/...) — le routeur .htaccess laisse passer ^assets/ sans le
// réécrire vers le dossier de la commune.
// Une image propre à une ville reste, elle, en chemin relatif (public/images/…),
// donc résolue dans le dossier de la commune. Voir absolutizeAssets().
const ASSETS_DIR = 'assets';
const ASSETS_URL = '/assets';

// Identité du réseau. La marque est par commune (buildMarque : « Couvreur X »),
// le téléphone est global. Pas d'adresse email sur les sites.
const PHONE     = '09 80 40 96 11';
const PHONE_TEL = '+33980409611';

// Images du template. La clé est le chemin RELATIF tel qu'écrit dans le HTML —
// c'est aussi le chemin d'un éventuel override par ville :
//   public/images/villes/{slug}/{cle}.{ext}
// Toutes sont mutualisées dans /assets sauf override. Voir absolutizeAssets().
const IMG_DEFAULTS = {
  'a-propos-couvreur.webp':            path.join(__dirname, 'public', 'images', 'a-propos-couvreur.webp'),
  'fond-couvreur.webp':                path.join(__dirname, 'public', 'images', 'fond-couvreur.webp'),
  'logo-couvreur.webp':                path.join(__dirname, 'public', 'images', 'logo-couvreur.webp'),
  'favicon.png':                       path.join(__dirname, 'public', 'images', 'favicon.png'),
  'tuiles.avif':                       path.join(__dirname, 'public', 'images', 'tuiles.avif'),
  'toit-ardoise.avif':                 path.join(__dirname, 'public', 'images', 'toit-ardoise.avif'),
  'toit-zinc.avif':                    path.join(__dirname, 'public', 'images', 'toit-zinc.avif'),
  'services/renovation-toiture.webp':  path.join(__dirname, 'public', 'images', 'services', 'renovation-toiture.webp'),
  'services/pose-gouttieres.webp':     path.join(__dirname, 'public', 'images', 'services', 'pose-gouttieres.webp'),
  'services/nettoyage-toiture.webp':   path.join(__dirname, 'public', 'images', 'services', 'nettoyage-toiture.webp'),
  'services/zinguerie.webp':           path.join(__dirname, 'public', 'images', 'services', 'zinguerie.webp'),
  'services/fenetre-de-toit.webp':     path.join(__dirname, 'public', 'images', 'services', 'fenetre-de-toit.webp'),
  'services/isolation-toiture.webp':   path.join(__dirname, 'public', 'images', 'services', 'isolation-toiture.webp'),
};

// Config Supabase depuis .env
const SUPABASE_JSON = JSON.stringify({
  directUrl: ENV.SUPABASE_URL || '',
  url:       ENV.SUPABASE_USE_RELATIVE_API === '1' ? '' : (ENV.SUPABASE_URL || ''),
  relative:  ENV.SUPABASE_USE_RELATIVE_API === '1',
  anon:      ENV.SUPABASE_ANON_KEY || '',
  table:     ENV.SUPABASE_TABLE_COUVREUR || 'leads_couvreur',
});

// ─── Arguments CLI ───────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

const INDEX_ONLY = process.argv.includes('--index-only'); // skip CSS/assets : seulement index.html + sitemap + robots
const depCode = getArg('--dep');
const depNomArg = getArg('--dep-nom');
// Domaine du département, issu du .site (ex. « couvreur-gironde-33.fr »).
// Les sous-domaines des communes en découlent : {slug}.{domainArg}
const domainArg = (getArg('--domain') || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');

if (!depCode || !depNomArg) {
  console.error('Usage : node generate.js --dep <code_dep> --dep-nom <nom_dep>');
  console.error('Exemple : node generate.js --dep 33 --dep-nom Gironde');
  process.exit(1);
}

// Slug du département : minuscules, sans accents, sans espaces/apostrophes
function slugifyDep(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['']/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}
const outDir = `${depCode}-${slugifyDep(depNomArg)}`;

// ─── Lecture des fichiers ─────────────────────────────────────────────────────

const ROOT_PARENT = path.resolve(__dirname, '..');

const communes        = JSON.parse(fs.readFileSync(path.join(ROOT_PARENT, 'data', 'communes.json'), 'utf8'));

// Index des adresses mairie (clé : nom_standard + '|' + dep_code normalisé)
const adresseMairieIndex = new Map();
try {
  const adrFile = path.join(ROOT_PARENT, 'data', 'communes_avec_adresses.json');
  if (fs.existsSync(adrFile)) {
    const adrData = JSON.parse(fs.readFileSync(adrFile, 'utf8'));
    if (Array.isArray(adrData)) {
      adrData.forEach(c => {
        if (c.adresse_mairie && c.adresse_mairie.trim()) {
          const key = c.nom_standard + '|' + String(c.dep_code).replace(/^0+/, '');
          adresseMairieIndex.set(key, c.adresse_mairie.trim());
        }
      });
    }
  }
  console.log(`📍 ${adresseMairieIndex.size} adresses mairie indexées depuis communes_avec_adresses.json`);
} catch (e) {
  console.warn(`⚠️   Lecture communes_avec_adresses.json échouée : ${e.message}`);
}
const variables       = JSON.parse(fs.readFileSync(path.join(__dirname,   'data', 'variables.json'), 'utf8'));

// Charge la liste des villes : prioritairement depuis ../json-communes/communes_XX.json
const depPad = (() => {
  const s = String(depCode).toUpperCase();
  if (s === '2A' || s === '2B') return '20'; // Corse fusionnée en dept 20
  if (s.length >= 3) return s;
  return s.padStart(2, '0');
})();
const communesFile = path.join(ROOT_PARENT, 'json-communes', `communes_${depPad}.json`);
const LIMIT_PER_DEP = 249;
function loadBatch(filePath) {
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let villes = [];
  if (Array.isArray(payload)) {
    villes = payload.slice(0, LIMIT_PER_DEP).map(c => c.nom_standard);
  } else if (Array.isArray(payload.villes)) {
    villes = payload.villes.slice(0, LIMIT_PER_DEP);
  } else {
    throw new Error('Format json-communes inconnu');
  }

  // Complément top-pop depuis data/communes.json si on n'atteint pas LIMIT_PER_DEP
  if (villes.length < LIMIT_PER_DEP) {
    const have = new Set(villes.map(v => normalise(v)));
    const matchDep = depPad === '20'
      ? ['2A', '2B']
      : [depPad.replace(/^0+/, '') || depPad];
    const extras = communes
      .filter(c => matchDep.includes(String(c.dep_code).toUpperCase().replace(/^0+/, '')))
      .filter(c => !have.has(normalise(c.nom_standard)))
      .sort((a, b) => (parseInt(b.population, 10) || 0) - (parseInt(a.population, 10) || 0))
      .slice(0, LIMIT_PER_DEP - villes.length)
      .map(c => c.nom_standard);
    villes = villes.concat(extras);
    if (extras.length) console.log(`➕  ${extras.length} commune(s) complétée(s) depuis data/communes.json (top pop manquantes)`);
  }
  return { _note: `Top ${villes.length} (limite ${LIMIT_PER_DEP})`, villes };
}
let batch;
if (fs.existsSync(communesFile)) {
  batch = loadBatch(communesFile);
  console.log(`📂 ${batch.villes.length} communes chargées depuis json-communes/communes_${depPad}.json (limite ${LIMIT_PER_DEP})`);
} else {
  console.warn(`⚠️   json-communes/communes_${depPad}.json introuvable — fallback sur data/batch.json`);
  batch = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'batch.json'), 'utf8'));
}

const template        = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ─── Index des communes ───────────────────────────────────────────────────────

// Chaque clé pointe vers un tableau (plusieurs communes peuvent partager un même nom)
const communeIndex = {};
communes.forEach(c => {
  [normalise(c.nom_standard), normalise(c.nom_sans_pronom), normalise(c.nom_sans_accent)].forEach(key => {
    if (!key) return;
    if (!communeIndex[key]) communeIndex[key] = [];
    if (!communeIndex[key].includes(c)) communeIndex[key].push(c);
  });
});

// Normalise : minuscules, sans accents, tirets/espaces/apostrophes tous équivalents — match quelle que soit l'orthographe saisie
function normalise(str) {
  return String(str)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['']/g, ' ')              // apostrophes → espace
    .replace(/[\s\-_]+/g, ' ')           // espaces, tirets, underscores → espace simple
    .trim();
}

// Alias d'orthographes locales/historiques → nom officiel INSEE (clés et valeurs déjà normalisées)
const COMMUNE_ALIASES = {
  'saint philippe d aiguilhe': 'saint philippe d aiguille',
};

// ─── Utilitaires ─────────────────────────────────────────────────────────────

// Deux passes : {{VAR}} pour le template, puis {VAR} pour les variables
// imbriquées dans les variantes de data/variables.json (ex. « ... {DEP_NOM} »).
function replace(tpl, vars) {
  return String(tpl)
    .replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m))
    .replace(/\{([A-Z0-9_]+)\}/g,     (m, k) => (vars[k] !== undefined ? vars[k] : m));
}

/** Échappe une chaîne pour insertion dans du JSON-LD */
function jsonLdEscape(s) {
  return JSON.stringify(String(s)).slice(1, -1);
}

/**
 * Bloc JSON-LD FAQPage construit à partir des variantes RÉELLEMENT affichées.
 * Le template d'origine embarquait 5 questions figées : sur 249 communes cela
 * produisait un balisage identique partout et contredisant le texte visible.
 */
function buildFaqJsonLd(vars) {
  const items = [1, 2, 3, 4, 5].map(i => {
    const q = vars[`FAQ_Q${i}`];
    const a = [vars[`FAQ_A${i}_1`], vars[`FAQ_A${i}_2`]].filter(Boolean).join(' ');
    if (!q || !a) return null;
    return `    {
      "@type": "Question",
      "name": "${jsonLdEscape(q)}",
      "acceptedAnswer": { "@type": "Answer", "text": "${jsonLdEscape(a)}" }
    }`;
  }).filter(Boolean);

  if (!items.length) return '';
  return `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
${items.join(',\n')}
  ]
}
</script>`;
}

function pickVariant(arr, seed, varKey) {
  // SHA-256 tronqué : garantit une distribution uniforme et sans pattern
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(seed + '::' + (varKey || '')).digest();
  const n = hash.readUInt32BE(0);
  return arr[n % arr.length];
}

// Choisit déterministiquement 3 indices de services (parmi 1..6) qui afficheront le nom de la ville dans leur titre
function pickServicesWithCity(seed) {
  const crypto = require('crypto');
  const indices = [1, 2, 3, 4, 5, 6].map(i => ({
    i,
    h: crypto.createHash('sha256').update(seed + '::service-loc::' + i).digest().readUInt32BE(0),
  }));
  indices.sort((a, b) => a.h - b.h);
  return new Set(indices.slice(0, 3).map(x => x.i));
}

/** Transforme un nom sans accent en slug URL-safe
 *  ex: "Villenave-d'Ornon" → "villenave-d-ornon"
 *      "Le Taillan-Médoc"  → "le-taillan-medoc"  (accents déjà retirés en amont)
 */
function slugify(str) {
  return str
    .toLowerCase()
    .replace(/['']/g, '-')   // apostrophes → tiret
    .replace(/\s+/g,  '-')   // espaces     → tiret
    .replace(/-{2,}/g, '-')  // tirets multiples → un seul
    .replace(/^-|-$/g, '');  // tirets en début/fin supprimés
}

// Formes grammaticales des départements (à/en + de/du/d'/des + le/la/l'/les)
const DEP_FORMES = {
  '1':  { a: "dans l'Ain",          de: "de l'Ain",          le: "l'Ain" },
  '2':  { a: "dans l'Aisne",        de: "de l'Aisne",        le: "l'Aisne" },
  '3':  { a: "dans l'Allier",       de: "de l'Allier",       le: "l'Allier" },
  '4':  { a: "dans les Alpes-de-Haute-Provence", de: "des Alpes-de-Haute-Provence", le: "les Alpes-de-Haute-Provence" },
  '5':  { a: "dans les Hautes-Alpes", de: "des Hautes-Alpes", le: "les Hautes-Alpes" },
  '6':  { a: "dans les Alpes-Maritimes", de: "des Alpes-Maritimes", le: "les Alpes-Maritimes" },
  '7':  { a: "en Ardèche",          de: "d'Ardèche",         le: "l'Ardèche" },
  '8':  { a: "dans les Ardennes",    de: "des Ardennes",      le: "les Ardennes" },
  '9':  { a: "en Ariège",           de: "d'Ariège",          le: "l'Ariège" },
  '10': { a: "dans l'Aube",         de: "de l'Aube",         le: "l'Aube" },
  '11': { a: "dans l'Aude",         de: "de l'Aude",         le: "l'Aude" },
  '12': { a: "dans l'Aveyron",      de: "de l'Aveyron",      le: "l'Aveyron" },
  '13': { a: "dans les Bouches-du-Rhône", de: "des Bouches-du-Rhône", le: "les Bouches-du-Rhône" },
  '14': { a: "dans le Calvados",     de: "du Calvados",       le: "le Calvados" },
  '15': { a: "dans le Cantal",       de: "du Cantal",         le: "le Cantal" },
  '16': { a: "en Charente",         de: "de Charente",        le: "la Charente" },
  '17': { a: "en Charente-Maritime", de: "de Charente-Maritime", le: "la Charente-Maritime" },
  '18': { a: "dans le Cher",         de: "du Cher",           le: "le Cher" },
  '19': { a: "en Corrèze",          de: "de Corrèze",        le: "la Corrèze" },
  '21': { a: "en Côte-d'Or",        de: "de Côte-d'Or",      le: "la Côte-d'Or" },
  '22': { a: "dans les Côtes-d'Armor", de: "des Côtes-d'Armor", le: "les Côtes-d'Armor" },
  '23': { a: "dans la Creuse",       de: "de la Creuse",      le: "la Creuse" },
  '24': { a: "en Dordogne",         de: "de Dordogne",        le: "la Dordogne" },
  '25': { a: "dans le Doubs",        de: "du Doubs",          le: "le Doubs" },
  '26': { a: "dans la Drôme",        de: "de la Drôme",       le: "la Drôme" },
  '27': { a: "dans l'Eure",         de: "de l'Eure",         le: "l'Eure" },
  '28': { a: "en Eure-et-Loir",     de: "d'Eure-et-Loir",    le: "l'Eure-et-Loir" },
  '29': { a: "dans le Finistère",    de: "du Finistère",      le: "le Finistère" },
  '20': { a: "en Corse",            de: "de Corse",           le: "la Corse" },
  '2A': { a: "en Corse-du-Sud",     de: "de Corse-du-Sud",    le: "la Corse-du-Sud" },
  '2B': { a: "en Haute-Corse",      de: "de Haute-Corse",     le: "la Haute-Corse" },
  '30': { a: "dans le Gard",         de: "du Gard",           le: "le Gard" },
  '31': { a: "en Haute-Garonne",    de: "de Haute-Garonne",   le: "la Haute-Garonne" },
  '32': { a: "dans le Gers",         de: "du Gers",           le: "le Gers" },
  '33': { a: "en Gironde",          de: "de Gironde",         le: "la Gironde" },
  '34': { a: "dans l'Hérault",      de: "de l'Hérault",      le: "l'Hérault" },
  '35': { a: "en Ille-et-Vilaine",  de: "d'Ille-et-Vilaine",  le: "l'Ille-et-Vilaine" },
  '36': { a: "dans l'Indre",        de: "de l'Indre",        le: "l'Indre" },
  '37': { a: "en Indre-et-Loire",   de: "d'Indre-et-Loire",   le: "l'Indre-et-Loire" },
  '38': { a: "en Isère",            de: "d'Isère",           le: "l'Isère" },
  '39': { a: "dans le Jura",         de: "du Jura",           le: "le Jura" },
  '40': { a: "dans les Landes",      de: "des Landes",        le: "les Landes" },
  '41': { a: "dans le Loir-et-Cher", de: "du Loir-et-Cher",   le: "le Loir-et-Cher" },
  '42': { a: "dans la Loire",        de: "de la Loire",       le: "la Loire" },
  '43': { a: "en Haute-Loire",      de: "de Haute-Loire",     le: "la Haute-Loire" },
  '44': { a: "en Loire-Atlantique", de: "de Loire-Atlantique", le: "la Loire-Atlantique" },
  '45': { a: "dans le Loiret",       de: "du Loiret",         le: "le Loiret" },
  '46': { a: "dans le Lot",          de: "du Lot",            le: "le Lot" },
  '47': { a: "dans le Lot-et-Garonne", de: "du Lot-et-Garonne", le: "le Lot-et-Garonne" },
  '48': { a: "en Lozère",           de: "de Lozère",          le: "la Lozère" },
  '49': { a: "dans le Maine-et-Loire", de: "du Maine-et-Loire", le: "le Maine-et-Loire" },
  '50': { a: "dans la Manche",       de: "de la Manche",      le: "la Manche" },
  '51': { a: "dans la Marne",        de: "de la Marne",       le: "la Marne" },
  '52': { a: "en Haute-Marne",      de: "de Haute-Marne",     le: "la Haute-Marne" },
  '53': { a: "en Mayenne",          de: "de Mayenne",          le: "la Mayenne" },
  '54': { a: "en Meurthe-et-Moselle", de: "de Meurthe-et-Moselle", le: "la Meurthe-et-Moselle" },
  '55': { a: "dans la Meuse",        de: "de la Meuse",       le: "la Meuse" },
  '56': { a: "dans le Morbihan",     de: "du Morbihan",       le: "le Morbihan" },
  '57': { a: "en Moselle",          de: "de Moselle",          le: "la Moselle" },
  '58': { a: "dans la Nièvre",       de: "de la Nièvre",      le: "la Nièvre" },
  '59': { a: "dans le Nord",         de: "du Nord",           le: "le Nord" },
  '60': { a: "dans l'Oise",         de: "de l'Oise",         le: "l'Oise" },
  '61': { a: "dans l'Orne",         de: "de l'Orne",         le: "l'Orne" },
  '62': { a: "dans le Pas-de-Calais", de: "du Pas-de-Calais", le: "le Pas-de-Calais" },
  '63': { a: "dans le Puy-de-Dôme",  de: "du Puy-de-Dôme",   le: "le Puy-de-Dôme" },
  '64': { a: "dans les Pyrénées-Atlantiques", de: "des Pyrénées-Atlantiques", le: "les Pyrénées-Atlantiques" },
  '65': { a: "dans les Hautes-Pyrénées", de: "des Hautes-Pyrénées", le: "les Hautes-Pyrénées" },
  '66': { a: "dans les Pyrénées-Orientales", de: "des Pyrénées-Orientales", le: "les Pyrénées-Orientales" },
  '67': { a: "dans le Bas-Rhin",     de: "du Bas-Rhin",       le: "le Bas-Rhin" },
  '68': { a: "dans le Haut-Rhin",    de: "du Haut-Rhin",      le: "le Haut-Rhin" },
  '69': { a: "dans le Rhône",        de: "du Rhône",          le: "le Rhône" },
  '70': { a: "en Haute-Saône",      de: "de Haute-Saône",     le: "la Haute-Saône" },
  '71': { a: "en Saône-et-Loire",   de: "de Saône-et-Loire",  le: "la Saône-et-Loire" },
  '72': { a: "dans la Sarthe",       de: "de la Sarthe",      le: "la Sarthe" },
  '73': { a: "en Savoie",           de: "de Savoie",          le: "la Savoie" },
  '74': { a: "en Haute-Savoie",     de: "de Haute-Savoie",    le: "la Haute-Savoie" },
  '75': { a: "à Paris",             de: "de Paris",           le: "Paris" },
  '76': { a: "en Seine-Maritime",   de: "de Seine-Maritime",   le: "la Seine-Maritime" },
  '77': { a: "en Seine-et-Marne",   de: "de Seine-et-Marne",  le: "la Seine-et-Marne" },
  '78': { a: "dans les Yvelines",    de: "des Yvelines",      le: "les Yvelines" },
  '79': { a: "dans les Deux-Sèvres", de: "des Deux-Sèvres",   le: "les Deux-Sèvres" },
  '80': { a: "dans la Somme",        de: "de la Somme",       le: "la Somme" },
  '81': { a: "dans le Tarn",         de: "du Tarn",           le: "le Tarn" },
  '82': { a: "dans le Tarn-et-Garonne", de: "du Tarn-et-Garonne", le: "le Tarn-et-Garonne" },
  '83': { a: "dans le Var",          de: "du Var",            le: "le Var" },
  '84': { a: "dans le Vaucluse",     de: "du Vaucluse",       le: "le Vaucluse" },
  '85': { a: "en Vendée",           de: "de Vendée",          le: "la Vendée" },
  '86': { a: "dans la Vienne",       de: "de la Vienne",      le: "la Vienne" },
  '87': { a: "en Haute-Vienne",     de: "de Haute-Vienne",    le: "la Haute-Vienne" },
  '88': { a: "dans les Vosges",      de: "des Vosges",        le: "les Vosges" },
  '89': { a: "dans l'Yonne",        de: "de l'Yonne",        le: "l'Yonne" },
  '90': { a: "dans le Territoire de Belfort", de: "du Territoire de Belfort", le: "le Territoire de Belfort" },
  '91': { a: "dans l'Essonne",      de: "de l'Essonne",      le: "l'Essonne" },
  '92': { a: "dans les Hauts-de-Seine", de: "des Hauts-de-Seine", le: "les Hauts-de-Seine" },
  '93': { a: "en Seine-Saint-Denis", de: "de Seine-Saint-Denis", le: "la Seine-Saint-Denis" },
  '94': { a: "dans le Val-de-Marne", de: "du Val-de-Marne",   le: "le Val-de-Marne" },
  '95': { a: "dans le Val-d'Oise",  de: "du Val-d'Oise",     le: "le Val-d'Oise" },
  '971': { a: "en Guadeloupe",      de: "de Guadeloupe",      le: "la Guadeloupe" },
  '972': { a: "en Martinique",      de: "de Martinique",       le: "la Martinique" },
  '973': { a: "en Guyane",          de: "de Guyane",           le: "la Guyane" },
  '974': { a: "à La Réunion",       de: "de La Réunion",       le: "La Réunion" },
  '976': { a: "à Mayotte",          de: "de Mayotte",          le: "Mayotte" },
};

function getDepFormes(code, nom) {
  // Tente avec le code tel quel, puis sans zéros de tête (ex: "01" → "1")
  const k1 = String(code);
  const k2 = k1.replace(/^0+/, '');
  const f = DEP_FORMES[k1] || DEP_FORMES[k2];
  if (f) return f;
  return { a: `en ${nom}`, de: `de ${nom}`, le: `le ${nom}` };
}

function buildMarque(commune) {
  return `Couvreur ${commune.nom_standard}`;
}

function buildUrl(commune) {
  // Le domaine vient de --domain, donc du fichier .site du département — c'est
  // lui qui fait foi côté o2switch (`{commune}.{DOMAIN}`, un vhost wildcard).
  // Sans --domain on retombe sur l'ancien schéma, pour ne pas casser les usages
  // hors o2switch du générateur.
  if (domainArg) return `${slugify(commune.nom_sans_accent)}.${domainArg}`;

  // Padding 2 chiffres (01, 02, …, 09, 10+). 2A/2B et outre-mer 971+ restent intacts.
  const raw = String(commune.dep_code).toUpperCase();
  const dep = (raw === '2A' || raw === '2B' || raw.length >= 3) ? raw : raw.padStart(2, '0');
  return `${slugify(commune.nom_sans_accent)}.couvreur${dep}-pro.fr`;
}

// ─── Communes proches (haversine) ────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function nearestCommunes(source, allCommunes, n, validSet) {
  if (typeof source.lat !== 'number' || typeof source.lon !== 'number') return [];
  const candidates = [];
  for (const c of allCommunes) {
    if (c === source) continue;
    if (validSet && !validSet.has(c)) continue; // exclut les communes non-générées (pas de liens morts)
    if (typeof c.lat !== 'number' || typeof c.lon !== 'number') continue;
    if (c.nom_standard === source.nom_standard && c.code_postal === source.code_postal) continue;
    const d = haversine(source.lat, source.lon, c.lat, c.lon);
    candidates.push({ c, d });
  }
  candidates.sort((a, b) => a.d - b.d);
  return candidates.slice(0, n).map(({ c }) => ({
    nom: c.nom_standard,
    url: buildUrl(c),
  }));
}

function renderCommunesProches(list) {
  return list.map(p => `
          <a href="https://${p.url}" class="commune-tile">
            <span class="commune-tile-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
            </span>
            <span class="commune-tile-name">${p.nom}</span>
          </a>`).join('\n');
}

// ─── Section "Pour tous vos besoins de pose et de rénovation de toiture {Ville}" (éditoriale) ─

const PREFECTURES = {
  '01': { nom: 'Bourg-en-Bresse', lat: 46.2050, lon: 5.2256 },
  '02': { nom: 'Laon', lat: 49.5639, lon: 3.6244 },
  '03': { nom: 'Moulins', lat: 46.5667, lon: 3.3333 },
  '04': { nom: 'Digne-les-Bains', lat: 44.0925, lon: 6.2356 },
  '05': { nom: 'Gap', lat: 44.5594, lon: 6.0786 },
  '06': { nom: 'Nice', lat: 43.7034, lon: 7.2663 },
  '07': { nom: 'Privas', lat: 44.7350, lon: 4.5994 },
  '08': { nom: 'Charleville-Mézières', lat: 49.7726, lon: 4.7197 },
  '09': { nom: 'Foix', lat: 42.9633, lon: 1.6053 },
  '10': { nom: 'Troyes', lat: 48.2972, lon: 4.0744 },
  '11': { nom: 'Carcassonne', lat: 43.2128, lon: 2.3500 },
  '12': { nom: 'Rodez', lat: 44.3506, lon: 2.5731 },
  '13': { nom: 'Marseille', lat: 43.2965, lon: 5.3698 },
  '14': { nom: 'Caen', lat: 49.1829, lon: -0.3707 },
  '15': { nom: 'Aurillac', lat: 44.9311, lon: 2.4439 },
  '16': { nom: 'Angoulême', lat: 45.6486, lon: 0.1561 },
  '17': { nom: 'La Rochelle', lat: 46.1591, lon: -1.1517 },
  '18': { nom: 'Bourges', lat: 47.0810, lon: 2.3989 },
  '19': { nom: 'Tulle', lat: 45.2667, lon: 1.7667 },
  '20': { nom: 'Ajaccio', lat: 41.9192, lon: 8.7386 },
  '21': { nom: 'Dijon', lat: 47.3220, lon: 5.0415 },
  '22': { nom: 'Saint-Brieuc', lat: 48.5136, lon: -2.7656 },
  '23': { nom: 'Guéret', lat: 46.1714, lon: 1.8722 },
  '24': { nom: 'Périgueux', lat: 45.1842, lon: 0.7214 },
  '25': { nom: 'Besançon', lat: 47.2378, lon: 6.0241 },
  '26': { nom: 'Valence', lat: 44.9333, lon: 4.8917 },
  '27': { nom: 'Évreux', lat: 49.0270, lon: 1.1510 },
  '28': { nom: 'Chartres', lat: 48.4470, lon: 1.4889 },
  '29': { nom: 'Quimper', lat: 47.9960, lon: -4.0978 },
  '2A': { nom: 'Ajaccio', lat: 41.9192, lon: 8.7386 },
  '2B': { nom: 'Bastia', lat: 42.7028, lon: 9.4502 },
  '30': { nom: 'Nîmes', lat: 43.8367, lon: 4.3601 },
  '31': { nom: 'Toulouse', lat: 43.6047, lon: 1.4442 },
  '32': { nom: 'Auch', lat: 43.6464, lon: 0.5861 },
  '33': { nom: 'Bordeaux', lat: 44.8378, lon: -0.5792 },
  '34': { nom: 'Montpellier', lat: 43.6108, lon: 3.8767 },
  '35': { nom: 'Rennes', lat: 48.1173, lon: -1.6778 },
  '36': { nom: 'Châteauroux', lat: 46.8103, lon: 1.6906 },
  '37': { nom: 'Tours', lat: 47.3941, lon: 0.6848 },
  '38': { nom: 'Grenoble', lat: 45.1885, lon: 5.7245 },
  '39': { nom: 'Lons-le-Saunier', lat: 46.6740, lon: 5.5500 },
  '40': { nom: 'Mont-de-Marsan', lat: 43.8909, lon: -0.5004 },
  '41': { nom: 'Blois', lat: 47.5860, lon: 1.3359 },
  '42': { nom: 'Saint-Étienne', lat: 45.4397, lon: 4.3872 },
  '43': { nom: 'Le Puy-en-Velay', lat: 45.0431, lon: 3.8851 },
  '44': { nom: 'Nantes', lat: 47.2184, lon: -1.5536 },
  '45': { nom: 'Orléans', lat: 47.9029, lon: 1.9039 },
  '46': { nom: 'Cahors', lat: 44.4475, lon: 1.4406 },
  '47': { nom: 'Agen', lat: 44.2050, lon: 0.6164 },
  '48': { nom: 'Mende', lat: 44.5183, lon: 3.5012 },
  '49': { nom: 'Angers', lat: 47.4784, lon: -0.5632 },
  '50': { nom: 'Saint-Lô', lat: 49.1158, lon: -1.0890 },
  '51': { nom: 'Châlons-en-Champagne', lat: 48.9569, lon: 4.3631 },
  '52': { nom: 'Chaumont', lat: 48.1119, lon: 5.1392 },
  '53': { nom: 'Laval', lat: 48.0710, lon: -0.7691 },
  '54': { nom: 'Nancy', lat: 48.6921, lon: 6.1844 },
  '55': { nom: 'Bar-le-Duc', lat: 48.7733, lon: 5.1614 },
  '56': { nom: 'Vannes', lat: 47.6587, lon: -2.7603 },
  '57': { nom: 'Metz', lat: 49.1193, lon: 6.1757 },
  '58': { nom: 'Nevers', lat: 46.9933, lon: 3.1572 },
  '59': { nom: 'Lille', lat: 50.6292, lon: 3.0573 },
  '60': { nom: 'Beauvais', lat: 49.4295, lon: 2.0805 },
  '61': { nom: 'Alençon', lat: 48.4317, lon: 0.0917 },
  '62': { nom: 'Arras', lat: 50.2910, lon: 2.7775 },
  '63': { nom: 'Clermont-Ferrand', lat: 45.7772, lon: 3.0870 },
  '64': { nom: 'Pau', lat: 43.2951, lon: -0.3708 },
  '65': { nom: 'Tarbes', lat: 43.2330, lon: 0.0784 },
  '66': { nom: 'Perpignan', lat: 42.6886, lon: 2.8949 },
  '67': { nom: 'Strasbourg', lat: 48.5734, lon: 7.7521 },
  '68': { nom: 'Colmar', lat: 48.0794, lon: 7.3585 },
  '69': { nom: 'Lyon', lat: 45.7640, lon: 4.8357 },
  '70': { nom: 'Vesoul', lat: 47.6253, lon: 6.1539 },
  '71': { nom: 'Mâcon', lat: 46.3060, lon: 4.8290 },
  '72': { nom: 'Le Mans', lat: 48.0061, lon: 0.1996 },
  '73': { nom: 'Chambéry', lat: 45.5646, lon: 5.9178 },
  '74': { nom: 'Annecy', lat: 45.8992, lon: 6.1294 },
  '75': { nom: 'Paris', lat: 48.8566, lon: 2.3522 },
  '76': { nom: 'Rouen', lat: 49.4432, lon: 1.0993 },
  '77': { nom: 'Melun', lat: 48.5402, lon: 2.6603 },
  '78': { nom: 'Versailles', lat: 48.8049, lon: 2.1204 },
  '79': { nom: 'Niort', lat: 46.3239, lon: -0.4584 },
  '80': { nom: 'Amiens', lat: 49.8941, lon: 2.2958 },
  '81': { nom: 'Albi', lat: 43.9290, lon: 2.1480 },
  '82': { nom: 'Montauban', lat: 44.0181, lon: 1.3550 },
  '83': { nom: 'Toulon', lat: 43.1242, lon: 5.9280 },
  '84': { nom: 'Avignon', lat: 43.9493, lon: 4.8055 },
  '85': { nom: 'La Roche-sur-Yon', lat: 46.6707, lon: -1.4267 },
  '86': { nom: 'Poitiers', lat: 46.5802, lon: 0.3404 },
  '87': { nom: 'Limoges', lat: 45.8336, lon: 1.2611 },
  '88': { nom: 'Épinal', lat: 48.1736, lon: 6.4496 },
  '89': { nom: 'Auxerre', lat: 47.7980, lon: 3.5697 },
  '90': { nom: 'Belfort', lat: 47.6377, lon: 6.8633 },
  '91': { nom: 'Évry-Courcouronnes', lat: 48.6239, lon: 2.4400 },
  '92': { nom: 'Nanterre', lat: 48.8924, lon: 2.2069 },
  '93': { nom: 'Bobigny', lat: 48.9069, lon: 2.4393 },
  '94': { nom: 'Créteil', lat: 48.7900, lon: 2.4550 },
  '95': { nom: 'Pontoise', lat: 49.0517, lon: 2.0931 },
};

// Climat dominant par dept
const CLIMATS = {
  '14': 'atlantique', '17': 'atlantique', '22': 'atlantique', '29': 'atlantique',
  '33': 'atlantique', '35': 'atlantique', '40': 'atlantique', '44': 'atlantique',
  '50': 'atlantique', '56': 'atlantique', '64': 'atlantique', '76': 'atlantique', '85': 'atlantique',
  '06': 'mediterraneen', '11': 'mediterraneen', '13': 'mediterraneen', '2A': 'mediterraneen',
  '2B': 'mediterraneen', '20': 'mediterraneen', '30': 'mediterraneen', '34': 'mediterraneen',
  '66': 'mediterraneen', '83': 'mediterraneen', '84': 'mediterraneen',
  '04': 'montagne', '05': 'montagne', '09': 'montagne', '15': 'montagne',
  '38': 'montagne', '43': 'montagne', '63': 'montagne', '65': 'montagne',
  '73': 'montagne', '74': 'montagne', '88': 'montagne',
  '01': 'continental', '08': 'continental', '10': 'continental', '21': 'continental',
  '25': 'continental', '39': 'continental', '51': 'continental', '52': 'continental',
  '54': 'continental', '55': 'continental', '57': 'continental', '67': 'continental',
  '68': 'continental', '70': 'continental', '71': 'continental', '90': 'continental',
};

function bearing(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
function compassDirection(lat1, lon1, lat2, lon2) {
  const b = bearing(lat1, lon1, lat2, lon2);
  const sectors = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];
  return sectors[Math.round(b / 45) % 8];
}

// Données enrichies par dept (Wikipedia OPTIONNEL — section fonctionne sans)
let enrichedData = null;
function getEnrichedData(padded) {
  if (enrichedData !== null) return enrichedData;
  const file = path.join(__dirname, 'data', `communes-enriched-${padded}.json`);
  if (fs.existsSync(file)) {
    try { enrichedData = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { enrichedData = {}; }
    console.log(`🌐 ${Object.keys(enrichedData).length} communes enrichies (Wikipedia bonus) chargées`);
  } else {
    console.log(`ℹ️   Pas de fichier d'enrichissement Wikipedia pour dept ${padded} (section ville-intro fonctionne quand même, sans extracts Wikipedia)`);
    enrichedData = {};
  }
  return enrichedData;
}

// Templates de paragraphes pour la section ville-intro
let villeParaTpl = null;
function getVilleParaTpl() {
  if (villeParaTpl !== null) return villeParaTpl;
  const file = path.join(__dirname, 'data', 'ville-paragraphes.json');
  if (fs.existsSync(file)) {
    try { villeParaTpl = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { villeParaTpl = {}; }
  } else {
    villeParaTpl = {};
  }
  return villeParaTpl;
}

function formatFR(n) {
  if (n == null || isNaN(n)) return '';
  return Number(n).toLocaleString('fr-FR');
}

function extractCourt(extract) {
  if (!extract) return '';
  const match = extract.match(/^.{30,300}?[.!?](?=\s|$)/);
  return match ? match[0].trim() : extract.slice(0, 220).trim();
}

function buildVilleIntroHtml(commune, slug) {
  const rawDep = String(commune.dep_code).toUpperCase();
  const padded = (rawDep === '2A' || rawDep === '2B' || rawDep.length >= 3)
    ? rawDep
    : rawDep.padStart(2, '0');

  const pref = PREFECTURES[padded];
  if (!pref) return '';
  const tpl = getVilleParaTpl();
  if (!tpl.para_intro) return '';

  const pop = parseInt(commune.population, 10);
  const sup = parseFloat(commune.superficie_km2);
  if (!pop || !sup) return '';

  const isPrefecture = commune.nom_standard === pref.nom;
  if (!isPrefecture && (typeof commune.lat !== 'number' || typeof commune.lon !== 'number')) {
    return '';
  }

  const climat = CLIMATS[padded] || 'tempere';
  const climatKey = `para_climat_${climat}`;
  const climatPool = (tpl[climatKey] && tpl[climatKey].length) ? tpl[climatKey] : tpl.para_climat_tempere;
  if (!climatPool?.length || !tpl.para_bati?.length || !tpl.para_engagement?.length) return '';

  let distKm = 0, direction = '';
  if (typeof commune.lat === 'number' && typeof commune.lon === 'number') {
    distKm = Math.round(haversine(commune.lat, commune.lon, pref.lat, pref.lon));
    direction = compassDirection(pref.lat, pref.lon, commune.lat, commune.lon);
  }

  const elideDe = (name) => /^[aeiouhAEIOUH]/.test(name) ? `d'${name}` : `de ${name}`;
  const prefDe = elideDe(pref.nom);

  const localisation = isPrefecture
    ? `préfecture ${getDepFormes(commune.dep_code, commune.dep_nom).de}`
    : (distKm <= 1 ? `à proximité immédiate ${prefDe}` : `à ${distKm} km ${direction} ${prefDe}`);

  const enr = getEnrichedData(padded)[`${commune.nom_standard}|${padded.replace(/^0+/, '') || padded}`] || {};
  const wikiDesc = enr.wikipedia?.description || '';
  const wikiExtCourt = extractCourt(enr.wikipedia?.extract);

  const vars = {
    NOM_COMPLET: commune.nom_standard,
    NOM_A: commune.nom_a || `à ${commune.nom_standard}`,
    NOM_DE: commune.nom_de || `de ${commune.nom_standard}`,
    DEP_NOM_DE: getDepFormes(commune.dep_code, commune.dep_nom).de,
    CODE_POSTAL: String(commune.code_postal).padStart(5, '0'),
    DISTANCE_KM: distKm,
    DIRECTION: direction,
    PREFECTURE: pref.nom,
    LOCALISATION: localisation,
    POPULATION_FR: formatFR(parseInt(commune.population, 10)),
    SUPERFICIE_FR: formatFR(parseFloat(commune.superficie_km2)),
    WIKI_DESCRIPTION_PHRASE: wikiDesc ? (wikiDesc.charAt(0).toUpperCase() + wikiDesc.slice(1) + '.') : '',
    WIKI_EXTRACT_COURT: wikiExtCourt,
    DESCRIPTOR_GEO: climat === 'mediterraneen' ? 'méditerranéen' :
                    climat === 'montagne' ? 'de moyenne ou haute altitude' :
                    climat === 'atlantique' ? 'à façade atlantique' :
                    climat === 'continental' ? 'à climat continental' : 'au climat tempéré',
  };

  // Filtre intro pool si wiki absent
  let introPool = tpl.para_intro;
  if (!wikiExtCourt) introPool = introPool.filter(v => !v.includes('{WIKI_EXTRACT_COURT}'));
  if (!wikiDesc)    introPool = introPool.filter(v => !v.includes('{WIKI_DESCRIPTION_PHRASE}'));
  if (introPool.length === 0) introPool = tpl.para_intro;

  const sections = [
    pickVariant(introPool, slug, 'intro'),
    pickVariant(climatPool, slug, 'climat'),
    pickVariant(tpl.para_bati, slug, 'bati'),
    pickVariant(tpl.para_engagement, slug, 'engagement'),
  ];

  const replaceSingle = (s) => s.replace(/\{([A-Z0-9_]+)\}/g, (m, k) => vars[k] !== undefined ? vars[k] : '');
  const paragraphs = sections.map(s => `<p>${replaceSingle(s)}</p>`).join('\n        ');
  return `<section class="section section-ville-intro" id="ville-intro" aria-labelledby="ville-intro-title">
      <div class="container">
        <h2 id="ville-intro-title" class="section-heading center">Pour tous vos besoins de pose et de rénovation de toiture ${commune.nom_a}</h2>
        ${paragraphs}
      </div>
    </section>`;
}

/** Normalise un numéro de tél en format href (ex: "05 56 12 34 56" → "+33556123456") */
function telToHref(tel) {
  const digits = tel.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) {
    return '+33' + digits.slice(1);
  }
  return '+' + digits;
}

// ─── Résolution des images par ville ─────────────────────────────────────────

/**
 * Pour chaque image, vérifie si une version spécifique à la ville existe.
 * Retourne { srcFile, overridden } pour chaque image.
 * overridden = true si la ville a sa propre variante ; dans ce cas seulement,
 * l'image est copiée dans le dossier de la commune et référencée en relatif.
 */
function resolveImages(slug) {
  const villeDir = path.join(__dirname, 'public', 'images', 'villes', slug);
  const resolved = {};

  Object.entries(IMG_DEFAULTS).forEach(([name, defaultSrc]) => {
    // `name` est le chemin relatif sous public/images/, sous-dossier compris
    // (ex. « services/zinguerie.webp ») — l'override le reproduit à l'identique.
    const cityFile   = path.join(villeDir, name);
    const overridden = fs.existsSync(cityFile);
    resolved[name] = {
      overridden,
      srcFile: overridden ? cityFile : defaultSrc,
    };
  });

  return resolved;
}

/**
 * Réécrit les références d'assets du HTML en chemins absolus /assets/…
 * Seules les images propres à la ville restent en relatif : le routeur
 * .htaccess les résout alors dans le dossier de la commune.
 * Ne touche pas aux URL absolues du JSON-LD (`https://…/public/images/…`) :
 * le motif exige le `="` ouvrant.
 */
function absolutizeAssets(html, imgs) {
  // Feuille de style et script : toujours mutualisés
  html = html.replace(/(\s(?:href|src)=)"style\.css"/g,  `$1"${ASSETS_URL}/style.css"`);
  html = html.replace(/(\s(?:href|src)=)"script\.js"/g,  `$1"${ASSETS_URL}/script.js"`);

  // Images : mutualisées sauf si la ville a sa propre variante
  Object.entries(imgs).forEach(([name, { overridden }]) => {
    if (overridden) return;
    const escaped = name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    html = html.replace(
      new RegExp(`(\\s(?:href|src)=)"public/images/${escaped}"`, 'g'),
      `$1"${ASSETS_URL}/images/${name}"`
    );
  });

  return html;
}

/**
 * Même réécriture pour la feuille de style : elle est servie depuis
 * /assets/style.css, donc un `url("public/images/…")` relatif y pointerait
 * vers /assets/public/images/… — il faut l'absolutiser aussi.
 */
function absolutizeCss(css) {
  return css.replace(/url\((["']?)public\/images\//g, `url($1${ASSETS_URL}/images/`);
}

/**
 * Écrit les assets partagés UNE SEULE FOIS à la racine de la sortie
 * (= racine du document root wildcard une fois déployé).
 */
function writeSharedAssets(outputBase) {
  const base   = path.join(outputBase, ASSETS_DIR);
  const imgOut = path.join(base, 'images');

  fs.mkdirSync(imgOut, { recursive: true });

  // Feuille de style, avec ses url() absolutisées
  fs.writeFileSync(
    path.join(base, 'style.css'),
    absolutizeCss(fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8')),
    'utf8'
  );

  // Script d'interactions + formulaire
  const scriptSrc = path.join(__dirname, 'script.js');
  if (fs.existsSync(scriptSrc)) fs.copyFileSync(scriptSrc, path.join(base, 'script.js'));

  // Images du template
  Object.entries(IMG_DEFAULTS).forEach(([name, srcFile]) => {
    if (!fs.existsSync(srcFile)) {
      console.warn(`⚠️   Image absente du générateur : ${name}`);
      return;
    }
    const dest = path.join(imgOut, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(srcFile, dest);
  });
}

/**
 * Copie dans le dossier de la commune les seules images qui lui sont propres.
 * Tout le reste vient de /assets — voir writeSharedAssets().
 */
function copyAssets(imgs, outPath) {
  Object.entries(imgs).forEach(([name, { srcFile, overridden }]) => {
    if (!overridden || !fs.existsSync(srcFile)) return;
    const dest = path.join(outPath, 'public', 'images', name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(srcFile, dest);
  });
}

// ─── Construction du dictionnaire de remplacement ────────────────────────────

function buildVars(commune) {
  const slug   = slugify(commune.nom_sans_accent);
  const marque = buildMarque(commune);
  const url    = buildUrl(commune);

  // Téléphone : champ "tel" dans communes.json, sinon constante par défaut
  const tel     = (commune.tel     || TEL_DEFAULT).trim();
  const telHref = commune.tel_href || (commune.tel ? telToHref(commune.tel) : TEL_HREF_DEFAULT);

  // Pas de maillage inter-communes dans le template actuel : la section
  // « communes proches » a été retirée. nearestCommunes/renderCommunesProches
  // restent disponibles si le maillage est réintroduit un jour.

  const nomA = Array.isArray(commune.nom_a_variantes) && commune.nom_a_variantes.length > 0
                  ? pickVariant(commune.nom_a_variantes, slug, 'nom_a')
                  : commune.nom_a;
  const nomDe = Array.isArray(commune.nom_de_variantes) && commune.nom_de_variantes.length > 0
                  ? pickVariant(commune.nom_de_variantes, slug, 'nom_de')
                  : commune.nom_de;

  // 3 services sur 6 affichent le nom de la ville dans leur titre — sélection déterministe par slug
  const servicesWithCity = pickServicesWithCity(slug);
  const serviceLocVars = {};
  for (let i = 1; i <= 6; i++) {
    serviceLocVars[`SERVICE_LOC_${i}`] = servicesWithCity.has(i) ? ' ' + nomA : '';
  }

  // Adresse mairie (footer) — fallback sur "CP NOM_MAJ" si absente
  const adrKey = commune.nom_standard + '|' + String(commune.dep_code).replace(/^0+/, '');
  const adresseMairie = adresseMairieIndex.get(adrKey);
  const adresseFooter = adresseMairie || `${String(commune.code_postal).padStart(5, '0')} ${commune.nom_standard_majuscule}`;

  // Section ville-intro (4 paragraphes : intro factuelle, climat, bâti, engagement)
  const villeIntroHtml = buildVilleIntroHtml(commune, slug);

  // Auteurs des 3 avis : prénom + initiales, déterministes par commune
  const avis = [1, 2, 3].map(i => {
    const pool   = i % 2 === 0 ? (variables._avis_prenoms_f || ['Marie'])
                               : (variables._avis_prenoms_h || ['Marc']);
    const prenom = pickVariant(pool, slug, 'avis_prenom_' + i);
    const nom    = pickVariant(variables._avis_noms || ['L.'], slug, 'avis_nom_' + i);
    return { full: `${prenom} ${nom}`, init: (prenom[0] + nom[0]).toUpperCase() };
  });

  const staticVars = {
    ADRESSE:      adresseFooter,
    VILLE_INTRO:  villeIntroHtml,
    NOM:          commune.nom_sans_pronom,
    NOM_COMPLET:  commune.nom_standard,
    NOM_A:        nomA,
    NOM_DE:       nomDe,
    NOM_MAJ:      commune.nom_standard_majuscule,
    SLUG:        slug,
    CODE_POSTAL: String(commune.code_postal).padStart(5, '0'),
    DEP_NOM:      commune.dep_nom,
    DEP_NOM_A:    getDepFormes(depCode, commune.dep_nom).a,
    DEP_NOM_DE:   getDepFormes(depCode, commune.dep_nom).de,
    DEP_NOM_LE:   getDepFormes(depCode, commune.dep_nom).le,
    DEP_CODE:     String(depCode),
    REG_NOM:      commune.reg_nom || '',
    URL:         url,
    TEL:         tel,
    TEL_HREF:    telHref,
    // Le template couvreur 2 nomme le téléphone PHONE/PHONE_TEL.
    // PHONE_NBSP : espaces insécables, pour que le numéro ne coupe pas en fin de ligne.
    PHONE:       PHONE,
    PHONE_TEL:   PHONE_TEL,
    PHONE_NBSP:  PHONE.replace(/ /g, "&nbsp;"),
    YEAR:        String(new Date().getFullYear()),
    MARQUE:      marque,
    MARQUE_MAJ:  marque.toUpperCase(),
    GENTILE:     commune.gentile && commune.gentile.trim() ? commune.gentile.trim() : commune.nom_a,
    AVIS_1_NOM:  avis[0].full, AVIS_1_INIT: avis[0].init,
    AVIS_2_NOM:  avis[1].full, AVIS_2_INIT: avis[1].init,
    AVIS_3_NOM:  avis[2].full, AVIS_3_INIT: avis[2].init,
    // Lu par script.js via window.SUPA_CONFIG
    SUPABASE_CONFIG_JSON: SUPABASE_JSON,
    ...serviceLocVars,
  };

  const dynVars = {};
  Object.entries(variables).forEach(([key, variants]) => {
    if (!Array.isArray(variants)) return;
    // Les clés en « _ » ne sont pas des slots de texte mais des réservoirs
    // (_avis_prenoms_h, _avis_noms…) déjà consommés plus haut.
    if (key.startsWith('_')) return;
    const varKey = key.toUpperCase();           // "var_hero_lead" → "VAR_HERO_LEAD"
    const picked = pickVariant(variants, slug, key);
    if (typeof picked === 'string') {
      dynVars[varKey] = replace(picked, staticVars);
    } else if (typeof picked === 'object' && picked !== null) {
      Object.entries(picked).forEach(([subKey, subVal]) => {
        dynVars[`${varKey}_${subKey.toUpperCase()}`] = replace(subVal, staticVars);
      });
    }
  });

  const allVars = { ...staticVars, ...dynVars };

  // Doit venir après les variantes : le balisage reprend les questions/réponses
  // effectivement retenues pour cette commune.
  allVars.FAQ_JSONLD = buildFaqJsonLd(allVars);

  return allVars;
}

// ─── Génération ──────────────────────────────────────────────────────────────

const outputBase   = path.join(__dirname, 'output', outDir);

// Assets partagés : une copie pour tout le département, écrite avant les communes.
// Écrits même en --index-only pour que la sortie reste auto-suffisante (16 fichiers).
fs.mkdirSync(outputBase, { recursive: true });
writeSharedAssets(outputBase);

let generated      = 0;
let skipped        = 0;
const generatedUrls = [];   // URLs des sous-domaines générés (pour maj sitemap dép)

// Pré-pass : construire le set des communes "générables" (présentes dans un fichier json-communes/communes_XX.json).
// Garantit que chaque lien "communes proches" pointe vers une commune qui SERA générée tôt ou tard — pas de liens morts.
const generatedCommuneSet = new Set();
{
  const jsonCommunesDir = path.join(ROOT_PARENT, 'json-communes');
  const perDepCounts = {};

  if (!fs.existsSync(jsonCommunesDir)) {
    console.warn(`⚠️   ${jsonCommunesDir} introuvable — aucun lien cross-dep ne sera filtré`);
  } else {
    const files = fs.readdirSync(jsonCommunesDir).filter(f => /^communes_[\dA-Z]+\.json$/i.test(f));
    for (const file of files) {
      const m = file.match(/^communes_([\dA-Z]+)\.json$/i);
      if (!m) continue;
      const fileDepPadded = m[1].toUpperCase();
      // Convertit le code fichier (ex: "20" pour Corse) vers le format dep_code de communes.json
      let depForMatch;
      if (fileDepPadded === '20') {
        // Corse : le fichier "communes_20.json" couvre 2A et 2B — on accepte les deux
        depForMatch = ['2A', '2B'];
      } else {
        depForMatch = [fileDepPadded.replace(/^0+/, '') || fileDepPadded];
      }

      let payload;
      try {
        payload = JSON.parse(fs.readFileSync(path.join(jsonCommunesDir, file), 'utf8'));
      } catch (e) {
        console.warn(`⚠️   ${file} illisible : ${e.message}`);
        continue;
      }
      const names = Array.isArray(payload)
        ? payload.slice(0, LIMIT_PER_DEP).map(c => c.nom_standard)
        : (Array.isArray(payload.villes) ? payload.villes.slice(0, LIMIT_PER_DEP) : []);
      if (!names.length) continue;

      let added = 0;
      const have = new Set();
      names.forEach(villeNom => {
        const lookupKey = COMMUNE_ALIASES[normalise(villeNom)] || normalise(villeNom);
        const matches = communeIndex[lookupKey] || [];
        const commune = matches.find(c => depForMatch.includes(String(c.dep_code).toUpperCase().replace(/^0+/, '')));
        if (commune) have.add(commune);
        if (commune && !generatedCommuneSet.has(commune)) {
          generatedCommuneSet.add(commune);
          added++;
        }
      });
      // Complément top-pop aligné avec loadBatch
      if (have.size < LIMIT_PER_DEP) {
        const extras = communes
          .filter(c => depForMatch.includes(String(c.dep_code).toUpperCase().replace(/^0+/, '')))
          .filter(c => !have.has(c))
          .sort((a, b) => (parseInt(b.population, 10) || 0) - (parseInt(a.population, 10) || 0))
          .slice(0, LIMIT_PER_DEP - have.size);
        extras.forEach(c => { if (!generatedCommuneSet.has(c)) { generatedCommuneSet.add(c); added++; } });
      }
      perDepCounts[fileDepPadded] = added;
    }
  }
  const totalDeps = Object.keys(perDepCounts).length;
  console.log(`🔗 ${generatedCommuneSet.size} communes générables (${totalDeps} département(s) couverts par json-communes/) — aucun lien mort possible`);
}

batch.villes.forEach(villeNom => {
  const normalisedKey = normalise(villeNom);
  const lookupKey = COMMUNE_ALIASES[normalisedKey] || normalisedKey;
  const matches = communeIndex[lookupKey] || [];
  // Normalisation : on retire les zéros de tête pour comparer (ex: "01" === "1")
  const normDep = String(depCode).replace(/^0+/, '');
  const commune = matches.find(c => String(c.dep_code).replace(/^0+/, '') === normDep);

  if (!commune) {
    if (matches.length > 0) {
      console.warn(`⚠️   "${villeNom}" introuvable dans le département ${depCode} (existe dans : ${[...new Set(matches.map(c => c.dep_code))].join(', ')})`);
    } else {
      console.warn(`⚠️   Commune introuvable : "${villeNom}"`);
    }
    skipped++;
    return;
  }

  const slug    = slugify(commune.nom_sans_accent);
  const outPath = path.join(outputBase, slug);

  // HTML
  const allVars = buildVars(commune);
  const imgs    = resolveImages(slug);
  let   html    = absolutizeAssets(replace(template, allVars), imgs);

  // La config Supabase est injectée par la variable {{SUPABASE_CONFIG_JSON}}
  // du template (window.SUPA_CONFIG), plus par post-traitement du HTML.

  fs.mkdirSync(outPath, { recursive: true });
  fs.writeFileSync(path.join(outPath, 'index.html'), html, 'utf8');

  // Sitemap
  const siteUrl  = `https://${allVars.URL}`;
  const today    = new Date().toISOString().slice(0, 10);
  const sitemap  = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${siteUrl}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`;
  fs.writeFileSync(path.join(outPath, 'sitemap.xml'), sitemap, 'utf8');
  fs.writeFileSync(
    path.join(outPath, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`,
    'utf8'
  );
  // Seules les images propres à la ville sont copiées ici ; style.css, JS,
  // favicon, logos et images par défaut vivent dans /assets (writeSharedAssets).
  // --index-only saute cette copie : les assets en ligne sont déjà à jour.
  if (!INDEX_ONLY) {
    copyAssets(imgs, outPath);
  }

  generatedUrls.push(`https://${allVars.URL}`);
  console.log(`✅  ${commune.nom_standard.padEnd(30)} → ${outPath}`);
  generated++;
});

console.log(`\nTerminé : ${generated} site(s) généré(s), ${skipped} ignoré(s).`);

// ─── Sitemap département ─────────────────────────────────────────────────────
// Le sitemap du site département contient UNIQUEMENT les pages du site dept
// (home + mentions légales + politique). Les sous-domaines villes ont leur
// propre sitemap individuel — ils ne sont pas ajoutés au sitemap du dep.


