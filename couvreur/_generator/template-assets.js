/**
 * Couche assets du template couvreur, partagée par generate.js (communes) et
 * generate-dep.js (site départemental).
 *
 * Elle existe précisément parce que ces deux générateurs ont déjà divergé une
 * fois : ils partageaient data/variables.json et style.css, et remplacer le
 * template des communes a cassé le départemental sans que rien ne le signale.
 * Tout ce qui doit rester identique entre les deux vit ici.
 *
 * Principe (voir PROJET-O2SWITCH.md §7) : les assets sont écrits UNE fois à la
 * racine du document root, et le HTML les référence en chemin absolu /assets/…
 */
const fs   = require('fs');
const path = require('path');

const ASSETS_DIR = 'assets';
const ASSETS_URL = '/assets';

/** Images du template. La clé est le chemin relatif sous public/images/. */
function imgDefaults(dir) {
  const p = (...s) => path.join(dir, 'public', 'images', ...s);
  return {
    'a-propos-couvreur.webp':           p('a-propos-couvreur.webp'),
    'fond-couvreur.webp':               p('fond-couvreur.webp'),
    'logo-couvreur.webp':               p('logo-couvreur.webp'),
    'favicon.png':                      p('favicon.png'),
    'tuiles.avif':                      p('tuiles.avif'),
    'toit-ardoise.avif':                p('toit-ardoise.avif'),
    'toit-zinc.avif':                   p('toit-zinc.avif'),
    'services/renovation-toiture.webp': p('services', 'renovation-toiture.webp'),
    'services/pose-gouttieres.webp':    p('services', 'pose-gouttieres.webp'),
    'services/nettoyage-toiture.webp':  p('services', 'nettoyage-toiture.webp'),
    'services/zinguerie.webp':          p('services', 'zinguerie.webp'),
    'services/fenetre-de-toit.webp':    p('services', 'fenetre-de-toit.webp'),
    'services/isolation-toiture.webp':  p('services', 'isolation-toiture.webp'),
  };
}

/**
 * Réécrit les références d'assets du HTML en chemins absolus /assets/…
 * `overrides` : ensemble des clés d'images propres à la page, qui doivent rester
 * en relatif pour être résolues dans le dossier de la commune.
 */
function absolutizeAssets(html, overrides) {
  const ov = overrides || new Set();
  html = html.replace(/(\s(?:href|src)=)"style\.css"/g, `$1"${ASSETS_URL}/style.css"`);
  html = html.replace(/(\s(?:href|src)=)"script\.js"/g, `$1"${ASSETS_URL}/script.js"`);

  Object.keys(imgDefaults('.')).forEach(name => {
    if (ov.has(name)) return;
    const escaped = name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    html = html.replace(
      new RegExp(`(\\s(?:href|src)=)"public/images/${escaped}"`, 'g'),
      `$1"${ASSETS_URL}/images/${name}"`
    );
  });
  return html;
}

/**
 * La feuille est servie depuis /assets/style.css : un url("public/images/…")
 * relatif y pointerait vers /assets/public/images/… et casserait la bannière.
 */
function absolutizeCss(css) {
  return css.replace(/url\((["']?)public\/images\//g, `url($1${ASSETS_URL}/images/`);
}

/**
 * Écrit assets/ (style.css, script.js, images) à la racine d'une sortie.
 * `dir` est la racine du générateur, `outputBase` la racine du document root.
 */
function writeSharedAssets(dir, outputBase) {
  const base   = path.join(outputBase, ASSETS_DIR);
  const imgOut = path.join(base, 'images');
  fs.mkdirSync(imgOut, { recursive: true });

  fs.writeFileSync(
    path.join(base, 'style.css'),
    absolutizeCss(fs.readFileSync(path.join(dir, 'style.css'), 'utf8')),
    'utf8'
  );

  const scriptSrc = path.join(dir, 'script.js');
  if (fs.existsSync(scriptSrc)) fs.copyFileSync(scriptSrc, path.join(base, 'script.js'));

  Object.entries(imgDefaults(dir)).forEach(([name, srcFile]) => {
    if (!fs.existsSync(srcFile)) { console.warn(`⚠️   Image absente : ${name}`); return; }
    const dest = path.join(imgOut, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(srcFile, dest);
  });
}

/** Deux passes : {{VAR}} du template, puis {VAR} imbriqué dans les variantes. */
function replace(tpl, vars) {
  return String(tpl)
    .replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m))
    .replace(/\{([A-Z0-9_]+)\}/g,     (m, k) => (vars[k] !== undefined ? vars[k] : m));
}

/** Balisage FAQPage construit depuis les variantes réellement affichées. */
function buildFaqJsonLd(vars) {
  const esc = s => JSON.stringify(String(s)).slice(1, -1);
  const items = [1, 2, 3, 4, 5].map(i => {
    const q = vars[`FAQ_Q${i}`];
    const a = [vars[`FAQ_A${i}_1`], vars[`FAQ_A${i}_2`]].filter(Boolean).join(' ');
    if (!q || !a) return null;
    return `    {
      "@type": "Question",
      "name": "${esc(q)}",
      "acceptedAnswer": { "@type": "Answer", "text": "${esc(a)}" }
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

/** Auteurs des 3 avis, déterministes pour une graine donnée. */
function buildAvis(variables, seed, pickVariant) {
  return [1, 2, 3].map(i => {
    const pool   = i % 2 === 0 ? (variables._avis_prenoms_f || ['Marie'])
                               : (variables._avis_prenoms_h || ['Marc']);
    const prenom = pickVariant(pool, seed, 'avis_prenom_' + i);
    const nom    = pickVariant(variables._avis_noms || ['L.'], seed, 'avis_nom_' + i);
    return { full: `${prenom} ${nom}`, init: (prenom[0] + nom[0]).toUpperCase() };
  });
}

module.exports = {
  ASSETS_DIR, ASSETS_URL,
  imgDefaults, absolutizeAssets, absolutizeCss, writeSharedAssets,
  replace, buildFaqJsonLd, buildAvis,
};
