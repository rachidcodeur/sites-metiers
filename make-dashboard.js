#!/usr/bin/env node
/**
 * Génère dashboard.html — suivi des sites mis en ligne.
 *
 *   node make-dashboard.js
 *
 * Trois niveaux : métier → département → communes. Sur la ligne d'une commune,
 * cinq liens dans l'ordre : le site, PageSpeed, l'indexation (site:), Google,
 * Bing. Page autonome, données figées à la génération.
 *
 * À distinguer de <metier>/cmd.html, qui est la procédure de MISE en ligne.
 * Celui-ci sert à SUIVRE ce qui est déjà en ligne.
 */
const fs   = require('fs');
const path = require('path');

const ROOT = __dirname;

// Couleur d'accent par métier. Le couvreur reprend l'orange de ses sites.
const ACCENTS = {
  couvreur:              { c: '#F28C1F', c2: '#BC5A00' },
  peintre:               { c: '#3B9BE8', c2: '#1F6FB0' },
  'peintre-en-batiment': { c: '#3B9BE8', c2: '#1F6FB0' },
  'peintre-interieur':   { c: '#E8913B', c2: '#B4661E' },
  'lavage-auto':         { c: '#2FBF9E', c2: '#1B8C72' },
};
const ACCENT_DEFAUT = { c: '#F28C1F', c2: '#BC5A00' };

const LIBELLES = {
  couvreur: 'Couvreur',
  peintre: 'Peintre en Bâtiment',
  'peintre-en-batiment': 'Peintre en Bâtiment',
  'peintre-interieur': 'Peintre Intérieur',
  'lavage-auto': 'Lavage Auto',
};

// Requête employée pour les recherches Google et Bing
const MOTS_CLES = {
  couvreur: 'couvreur',
  peintre: 'peintre en batiment',
  'peintre-en-batiment': 'peintre en batiment',
  'peintre-interieur': 'peintre interieur',
  'lavage-auto': 'lavage auto',
};

function lireSite(fp) {
  const conf = {};
  fs.readFileSync(fp, 'utf8').split('\n').forEach(l => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*)"?/);
    if (m) conf[m[1]] = m[2].trim();
  });
  return conf;
}

const slugify = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const metiers = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
  .filter(d => fs.existsSync(path.join(ROOT, d.name, '_generator')))
  .map(d => {
    const nom = d.name;
    const dir = path.join(ROOT, nom);

    let ref = [];
    try { ref = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'communes.json'), 'utf8')); }
    catch (_) {}

    const departements = fs.readdirSync(dir, { withFileTypes: true })
      .filter(x => x.isDirectory() && !x.name.startsWith('_'))
      .map(x => path.join(dir, x.name))
      .filter(p => fs.existsSync(path.join(p, '.site')))
      .map(p => {
        const conf = lireSite(path.join(p, '.site'));
        const villesDir = path.join(p, '_villes');
        const slugs = fs.existsSync(villesDir)
          ? fs.readdirSync(villesDir, { withFileTypes: true })
              .filter(v => v.isDirectory() && v.name !== 'assets').map(v => v.name)
          : [];

        const normDep = String(conf.DEP || '').replace(/^0+/, '');
        const infos = new Map();
        for (const c of ref) {
          if (String(c.dep_code).replace(/^0+/, '') !== normDep) continue;
          const s = slugify(c.nom_sans_accent || c.nom_standard);
          if (!infos.has(s)) infos.set(s, { nom: c.nom_standard, pop: parseInt(c.population, 10) || 0 });
        }

        const actifs = path.join(p, '.https-actives');
        const https = fs.existsSync(actifs)
          ? fs.readFileSync(actifs, 'utf8').split('\n').map(l => l.trim())
              .filter(l => l && !l.startsWith('#'))
          : [];

        return {
          rel: `${nom}/${path.basename(p)}`,
          nom: conf.DEP_NOM || path.basename(p),
          dep: conf.DEP || '',
          domain: conf.DOMAIN || '',
          https,
          communes: slugs.map(s => ({
            slug: s,
            nom: (infos.get(s) || {}).nom || s,
            pop: (infos.get(s) || {}).pop || 0,
          })).sort((a, b) => b.pop - a.pop || a.nom.localeCompare(b.nom, 'fr')),
        };
      })
      .filter(d2 => d2.domain)
      .sort((a, b) => (a.dep || '').localeCompare(b.dep || '', 'fr', { numeric: true }));

    return {
      slug: nom,
      nom: LIBELLES[nom] || nom.replace(/-/g, ' ').replace(/^./, m => m.toUpperCase()),
      motcle: MOTS_CLES[nom] || nom.replace(/-/g, ' '),
      accent: ACCENTS[nom] || ACCENT_DEFAUT,
      departements,
    };
  })
  .filter(m => m.departements.length);

if (!metiers.length) {
  console.error('❌ Aucun métier avec un département configuré.');
  process.exit(1);
}

const DONNEES = JSON.stringify({ metiers }).replace(/</g, '\\u003c');

const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Suivi des sites en ligne</title>
<style>
  :root{
    --bg:#0E1116; --bg2:#141920; --surface:#1A212B; --surface2:#212A36;
    --line:#252F3D; --line2:#334153;
    --ink:#E8EDF4; --ink2:#A3B2C4; --ink3:#6D7E92;
    --ok:#35C08A; --attente:#C9922E;
    --accent:#F28C1F; --accent2:#BC5A00;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
       background:var(--bg);color:var(--ink);min-height:100vh}

  .entete{border-bottom:1px solid var(--line);background:var(--bg2);
          padding:16px 24px;display:flex;align-items:center;gap:16px;
          position:sticky;top:0;z-index:20}
  .marque{font-weight:700;font-size:16.5px;letter-spacing:-.01em}
  .marque span{color:var(--ink3);font-weight:500}
  .fil{margin-left:auto;display:flex;align-items:center;gap:8px;
       font-size:13.5px;color:var(--ink3);flex-wrap:wrap}
  .fil button{background:none;border:0;color:var(--accent);cursor:pointer;
              font:600 13.5px system-ui;padding:0}
  .fil button:hover{text-decoration:underline}

  .page{max-width:1240px;margin:0 auto;padding:38px 24px 90px}
  h1{font-size:34px;letter-spacing:-.02em;text-align:center;margin-bottom:8px}
  .sous{text-align:center;color:var(--ink3);font-size:14.5px;margin-bottom:28px}
  .pilule{display:block;width:fit-content;margin:0 auto 30px;
          background:linear-gradient(135deg,var(--accent),var(--accent2));
          color:#fff;font-weight:600;font-size:14px;padding:8px 20px;border-radius:999px}

  input[type=search]{display:block;width:100%;max-width:620px;margin:0 auto 26px;
    font:15.5px system-ui;padding:13px 18px;border:1px solid var(--line2);
    border-radius:11px;background:var(--surface);color:var(--ink)}
  input[type=search]::placeholder{color:var(--ink3)}
  input[type=search]:focus{outline:0;border-color:var(--accent)}

  .cartes{display:grid;grid-template-columns:repeat(auto-fill,minmax(258px,1fr));gap:16px}
  .carte{position:relative;overflow:hidden;border:0;border-radius:15px;
         background:linear-gradient(135deg,var(--accent) 0%,var(--accent2) 100%);
         padding:20px 22px;cursor:pointer;text-align:left;color:#fff;
         box-shadow:0 6px 18px rgba(0,0,0,.30);
         transition:transform .16s ease,box-shadow .16s ease}
  .carte:hover{transform:translateY(-3px);box-shadow:0 12px 28px rgba(0,0,0,.42)}
  /* voile diagonal : donne du relief au dégradé sans changer la teinte */
  .carte::after{content:"";position:absolute;inset:0;pointer-events:none;
    background:linear-gradient(160deg,rgba(255,255,255,.16),rgba(255,255,255,0) 55%)}
  .carte>*{position:relative;z-index:1}
  .carte h3{font-size:17.5px;color:#fff;margin-bottom:7px;padding-right:38px}
  .carte .n{font-size:19px;font-weight:700;color:#fff;line-height:1.15}
  .carte .l{font-size:13.5px;color:rgba(255,255,255,.84);margin-top:2px}
  .carte .globe{position:absolute;top:15px;right:15px;z-index:2;
    width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.24);
    display:grid;place-items:center;font-size:15px;text-decoration:none;
    border:1px solid rgba(255,255,255,.28);transition:background .15s,transform .15s}
  .carte .globe:hover{background:rgba(255,255,255,.42);transform:scale(1.08)}
  .carte .barre{height:5px;border-radius:3px;background:rgba(255,255,255,.26);
    margin-top:15px;overflow:hidden}
  .carte .barre i{display:block;height:100%;background:#fff;border-radius:3px}
  .carte .pct{font-size:12.5px;color:rgba(255,255,255,.86);margin-top:7px}

  /* Métiers */
  .metiers{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px;
           max-width:1000px;margin:0 auto}
  .metier{background:var(--surface);border:1px solid var(--line);border-radius:16px;
          padding:26px 20px;text-align:center;cursor:pointer;color:inherit;
          transition:border-color .15s,transform .15s}
  .metier:hover{transform:translateY(-3px)}
  .metier .pastille{width:52px;height:52px;border-radius:14px;margin:0 auto 14px;
                    display:grid;place-items:center;font-size:24px;font-weight:700;color:#fff}
  .metier h3{font-size:17.5px;margin-bottom:4px}
  .metier p{font-size:13px;color:var(--ink3)}

  /* Lignes de communes */
  .liste{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--surface)}
  .liste .tete{background:linear-gradient(135deg,var(--accent),var(--accent2));
               color:#fff;font-weight:600;font-size:14.5px;padding:13px 18px;
               display:flex;align-items:center;gap:9px;flex-wrap:wrap}
  .ligne{display:flex;align-items:center;gap:14px;padding:11px 18px;
         border-top:1px solid var(--line)}
  .ligne:hover{background:var(--surface2)}
  .rang{width:44px;color:var(--ink3);font-size:13px;font-variant-numeric:tabular-nums;flex-shrink:0}
  .hote{flex:1;min-width:0;font-family:var(--mono);font-size:13.5px;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .hote b{font-family:system-ui;font-size:14.5px;font-weight:600;color:var(--ink)}
  .hote em{font-style:normal;color:var(--ink3);display:block;font-size:12.5px}
  .etat{width:8px;height:8px;border-radius:50%;background:var(--attente);flex-shrink:0}
  .ligne[data-https="1"] .etat{background:var(--ok)}
  .actions{display:flex;gap:6px;flex-shrink:0}
  .actions a{width:36px;height:34px;display:grid;place-items:center;border-radius:8px;
             background:var(--surface2);border:1px solid var(--line2);color:var(--ink2);
             text-decoration:none;font:600 12px system-ui;transition:all .13s}
  .actions a:hover{background:var(--accent);border-color:var(--accent);color:#fff}
  @media(max-width:720px){
    .ligne{flex-wrap:wrap} .rang{width:28px}
    .actions{width:100%;justify-content:flex-end}
  }
  .vide{text-align:center;color:var(--ink3);padding:46px 0}
</style>
</head>
<body>

<header class="entete">
  <div class="marque">Suivi <span>des sites en ligne</span></div>
  <nav class="fil" id="fil"></nav>
</header>

<div class="page" id="vue"></div>

<script>
const D = ${DONNEES};
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const vue = document.getElementById('vue');
const fil = document.getElementById('fil');

let iM = null, iD = null, q = '';

function accent(m){
  document.documentElement.style.setProperty('--accent',  m ? m.accent.c  : '#F28C1F');
  document.documentElement.style.setProperty('--accent2', m ? m.accent.c2 : '#BC5A00');
}

function filAriane(){
  fil.innerHTML = '';
  if (iM === null) return;
  const m = D.metiers[iM];
  fil.appendChild(Object.assign(document.createElement('button'),
    { textContent:'Métiers', onclick:()=>{ iM=null; iD=null; q=''; rendre(); } }));
  if (iD !== null) {
    fil.insertAdjacentHTML('beforeend', '<span>›</span>');
    fil.appendChild(Object.assign(document.createElement('button'),
      { textContent:m.nom, onclick:()=>{ iD=null; q=''; rendre(); } }));
    fil.insertAdjacentHTML('beforeend',
      '<span>› ' + esc(m.departements[iD].nom) + '</span>');
  } else {
    fil.insertAdjacentHTML('beforeend', '<span>› ' + esc(m.nom) + '</span>');
  }
}

/* Les 5 liens d'une commune, dans l'ordre demandé :
   le site · PageSpeed · indexation (site:) · Google · Bing */
function liens(m, d, c){
  const hote = c.slug + '.' + d.domain;
  const req  = encodeURIComponent(m.motcle + ' ' + c.nom);
  return [
    ['🔗', 'https://' + hote + '/',                                              'Ouvrir le site'],
    ['⚡', 'https://developers.google.com/speed/pagespeed/insights/?url=' + hote, 'PageSpeed Insights'],
    ['Gi', 'https://www.google.com/search?q=' + encodeURIComponent('site:' + hote), 'Indexation Google'],
    ['G',  'https://www.google.com/search?q=' + req,                              'Recherche Google'],
    ['B',  'https://www.bing.com/search?q=' + req,                                'Recherche Bing'],
  ].map(([t,u,titre]) =>
    '<a href="' + esc(u) + '" target="_blank" rel="noopener" title="' + esc(titre) + '">' + t + '</a>'
  ).join('');
}

function rendre(){
  filAriane();

  // ── Niveau 1 : métiers ────────────────────────────────────────────────────
  if (iM === null) {
    accent(null);
    const total = D.metiers.reduce((n,m)=>n+m.departements.reduce((k,d)=>k+d.communes.length,0),0);
    vue.innerHTML = '<h1>Suivi des sites</h1>' +
      '<p class="sous">Un métier, un département, puis les communes et leurs liens de contrôle.</p>' +
      '<span class="pilule">' + total.toLocaleString('fr-FR') + ' sites · ' + D.metiers.length + ' métier(s)</span>' +
      '<div class="metiers">' + D.metiers.map((m,i)=>{
        const nb = m.departements.reduce((k,d)=>k+d.communes.length,0);
        return '<button class="metier" data-m="'+i+'" style="border-color:'+m.accent.c+'33">' +
          '<span class="pastille" style="background:linear-gradient(135deg,'+m.accent.c+','+m.accent.c2+')">'+
          esc(m.nom[0])+'</span>' +
          '<h3>'+esc(m.nom)+'</h3>' +
          '<p>'+nb.toLocaleString('fr-FR')+' sites · '+m.departements.length+' département(s)</p></button>';
      }).join('') + '</div>';
    vue.querySelectorAll('[data-m]').forEach(b =>
      b.onclick = () => { iM = +b.dataset.m; q=''; rendre(); });
    return;
  }

  const m = D.metiers[iM];
  accent(m);

  // ── Niveau 2 : départements ───────────────────────────────────────────────
  if (iD === null) {
    const total = m.departements.reduce((k,d)=>k+d.communes.length,0);
    const vus = m.departements.filter(d =>
      !q || d.nom.toLowerCase().includes(q) || String(d.dep).includes(q));
    vue.innerHTML = '<h1>Sites ' + esc(m.nom) + '</h1>' +
      '<span class="pilule">' + total.toLocaleString('fr-FR') + ' sites · ' +
      m.departements.length + ' département(s)</span>' +
      '<input type="search" id="rech" placeholder="Rechercher un département…" value="'+esc(q)+'">' +
      (vus.length ? '<div class="cartes">' + vus.map(d => {
        const i = m.departements.indexOf(d);
        const pct = d.communes.length ? Math.round(d.https.length / d.communes.length * 100) : 0;
        const fini = d.https.length >= d.communes.length && d.communes.length > 0;
        const q = 'https://www.google.com/search?q=' + encodeURIComponent('site:' + d.domain);
        return '<div class="carte" data-d="'+i+'" role="button" tabindex="0">' +
          '<a class="globe" href="'+q+'" target="_blank" rel="noopener" title="'+
          (fini ? "Département complet — voir indexation Google" : "Mise en ligne en cours — voir indexation Google")+
          '">'+(fini ? '🌐' : '🕐')+'</a>' +
          '<h3>'+esc(m.nom)+' '+esc(d.dep)+'</h3>' +
          '<div class="n">'+d.communes.length+' sites</div>' +
          '<div class="l">'+esc(d.nom)+'</div>' +
          '<div class="barre"><i style="width:'+pct+'%"></i></div>' +
          '<div class="pct">'+d.https.length+' sites · '+pct+' %</div>' +
          '</div>';
      }).join('') + '</div>' : '<p class="vide">Aucun département ne correspond.</p>');
    const r = document.getElementById('rech');
    r.oninput = () => { q = r.value.trim().toLowerCase(); rendre();
      const n = document.getElementById('rech'); n.focus();
      n.setSelectionRange(n.value.length, n.value.length); };
    vue.querySelectorAll('[data-d]').forEach(b => {
      const ouvrir = e => { if (e.target.closest('.globe')) return; iD = +b.dataset.d; q=''; rendre(); };
      b.onclick = ouvrir;
      b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrir(e); } };
    });
    return;
  }

  // ── Niveau 3 : communes ───────────────────────────────────────────────────
  const d = m.departements[iD];
  const vus = d.communes.filter(c =>
    !q || c.nom.toLowerCase().includes(q) || c.slug.includes(q));
  vue.innerHTML = '<h1>' + esc(m.nom) + ' ' + esc(d.nom) + ' (' + esc(d.dep) + ')</h1>' +
    '<span class="pilule">' + d.communes.length + ' sites · ' + d.https.length + ' en HTTPS</span>' +
    '<input type="search" id="rech" placeholder="Rechercher une commune…" value="'+esc(q)+'">' +
    '<p class="sous">' + vus.length + ' affichés</p>' +
    (vus.length ? '<div class="liste"><div class="tete">🌐 ' + esc(d.domain) + ' · ' +
      d.communes.length + ' sites</div>' +
      vus.map((c,i) =>
        '<div class="ligne" data-https="'+(d.https.includes(c.slug)?1:0)+'">' +
        '<span class="rang">'+(i+1)+'.</span>' +
        '<span class="etat" title="'+(d.https.includes(c.slug)?'HTTPS actif':'HTTPS à activer')+'"></span>' +
        '<span class="hote"><b>'+esc(c.nom)+'</b><em>'+esc(c.slug+'.'+d.domain)+'</em></span>' +
        '<span class="actions">'+liens(m,d,c)+'</span></div>').join('') +
      '</div>' : '<p class="vide">Aucune commune ne correspond.</p>');
  const r = document.getElementById('rech');
  r.oninput = () => { q = r.value.trim().toLowerCase(); rendre();
    const n = document.getElementById('rech'); n.focus();
    n.setSelectionRange(n.value.length, n.value.length); };
}

rendre();
</script>
</body>
</html>`;

fs.writeFileSync(path.join(ROOT, 'dashboard.html'), html, 'utf8');
const total = metiers.reduce((n, m) => n + m.departements.reduce((k, d) => k + d.communes.length, 0), 0);
console.log(`✅ dashboard.html — ${metiers.length} métier(s), ${total} sites`);
console.log(`   open dashboard.html`);
