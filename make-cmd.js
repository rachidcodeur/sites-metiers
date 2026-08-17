#!/usr/bin/env node
/**
 * Génère la page de pilotage d'un métier : <metier>/cmd.html
 *
 *   node make-cmd.js couvreur
 *
 * La page liste les départements du métier et, pour chacun, ses communes. En
 * sélectionner une affiche les 4 étapes de mise en ligne, avec les commandes
 * à copier et les valeurs exactes à saisir dans cPanel.
 *
 * Les données sont figées dans la page au moment de la génération : elle
 * fonctionne hors ligne, ce qui est le but — on la consulte souvent quand
 * l'accès SSH est justement coupé.
 *
 * À relancer après avoir ajouté un département ou reconstruit les communes.
 */
const fs   = require('fs');
const path = require('path');

const ROOT       = __dirname;
const METIER     = process.argv[2] || 'couvreur';
const USER_CPANEL = 'movi6707';

const metierDir = path.join(ROOT, METIER);
if (!fs.existsSync(metierDir)) {
  console.error(`❌ Métier introuvable : ${metierDir}`);
  process.exit(1);
}

// ─── Données : un département par fichier .site ───────────────────────────────

function lireSite(fp) {
  const conf = {};
  fs.readFileSync(fp, 'utf8').split('\n').forEach(l => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*)"?/);
    if (m) conf[m[1]] = m[2].trim();
  });
  return conf;
}

let communesRef = [];
try {
  communesRef = JSON.parse(fs.readFileSync(path.join(metierDir, 'data', 'communes.json'), 'utf8'));
} catch (_) {
  console.warn('⚠️   communes.json illisible — noms et populations indisponibles');
}

const slugify = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const departements = fs.readdirSync(metierDir, { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('_'))
  .map(d => path.join(metierDir, d.name))
  .filter(p => fs.existsSync(path.join(p, '.site')))
  .map(p => {
    const conf = lireSite(path.join(p, '.site'));
    const villesDir = path.join(p, '_villes');
    const slugs = fs.existsSync(villesDir)
      ? fs.readdirSync(villesDir, { withFileTypes: true })
          .filter(d => d.isDirectory() && d.name !== 'assets').map(d => d.name)
      : [];

    // Nom affichable + population, pour trier par importance : si un plafond
    // Let's Encrypt est atteint, autant que les grosses villes soient déjà faites.
    const normDep = String(conf.DEP || '').replace(/^0+/, '');
    const infos = new Map();
    for (const c of communesRef) {
      if (String(c.dep_code).replace(/^0+/, '') !== normDep) continue;
      const s = slugify(c.nom_sans_accent || c.nom_standard);
      if (!infos.has(s)) infos.set(s, { nom: c.nom_standard, pop: parseInt(c.population, 10) || 0 });
    }

    const communes = slugs.map(s => ({
      slug: s,
      nom: (infos.get(s) || {}).nom || s,
      pop: (infos.get(s) || {}).pop || 0,
    })).sort((a, b) => b.pop - a.pop || a.nom.localeCompare(b.nom, 'fr'));

    // Communes dont la redirection HTTPS est déjà active
    const actifs = path.join(p, '.https-actives');
    const https = fs.existsSync(actifs)
      ? fs.readFileSync(actifs, 'utf8').split('\n').map(l => l.trim())
          .filter(l => l && !l.startsWith('#'))
      : [];

    return {
      rel: `${METIER}/${path.basename(p)}`,
      nom: conf.DEP_NOM || path.basename(p),
      dep: conf.DEP || '',
      domain: conf.DOMAIN || '',
      communes, https,
    };
  })
  .filter(d => d.domain)
  .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

if (!departements.length) {
  console.error('❌ Aucun département trouvé (fichier .site manquant ?)');
  process.exit(1);
}

// ─── Page ────────────────────────────────────────────────────────────────────

const DONNEES = JSON.stringify({ metier: METIER, user: USER_CPANEL, departements })
  .replace(/</g, '\\u003c');

const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Mise en ligne · ${METIER}</title>
<style>
  :root{
    --accent:#F28C1F; --accent-fort:#BC5A00; --accent-doux:#FDF0E1;
    --bg:#FBF8F3; --bg2:#F4EFE7; --surface:#fff;
    --ink:#1A1815; --ink2:#4A453E; --ink3:#7A7165;
    --line:#E7E1D6; --line2:#D8D0C2;
    --ok:#2E9E5B; --attente:#B98900;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    --r:12px;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
       background:var(--bg);color:var(--ink);padding:32px 20px 80px}
  .page{max-width:1080px;margin:0 auto}
  h1{font-size:30px;letter-spacing:-.02em;margin-bottom:6px}
  .sous{color:var(--ink3);font-size:14.5px;margin-bottom:28px}
  h2{font-size:15px;text-transform:uppercase;letter-spacing:.09em;
     color:var(--accent-fort);margin:0 0 14px}

  .bloc{background:var(--surface);border:1px solid var(--line);
        border-radius:var(--r);padding:22px 24px;margin-bottom:22px}

  /* Commande copiable */
  .cmd{display:flex;align-items:stretch;gap:0;margin:8px 0;
       border:1px solid var(--line2);border-radius:9px;overflow:hidden;background:#1A1815}
  .cmd code{flex:1;font-family:var(--mono);font-size:13.5px;color:#F4EFE7;
            padding:11px 14px;overflow-x:auto;white-space:pre}
  .cmd button{border:0;border-left:1px solid #3a352e;background:#2a251f;color:#F4EFE7;
              font:600 12.5px system-ui;padding:0 15px;cursor:pointer;white-space:nowrap}
  .cmd button:hover{background:var(--accent-fort);color:#fff}
  .cmd button.ok{background:var(--ok);color:#fff}

  /* Valeur à saisir dans cPanel */
  .val{display:grid;grid-template-columns:200px 1fr auto;gap:10px;align-items:center;
       padding:8px 0;border-bottom:1px dashed var(--line)}
  .val:last-child{border-bottom:0}
  .val span{color:var(--ink3);font-size:13.5px}
  .val b{font-family:var(--mono);font-size:13.5px;font-weight:600;word-break:break-all}
  .val button{border:1px solid var(--line2);background:var(--bg2);border-radius:7px;
              font:600 12px system-ui;padding:5px 11px;cursor:pointer;color:var(--ink2)}
  .val button:hover{border-color:var(--accent);color:var(--accent-fort)}
  .val button.ok{background:var(--ok);color:#fff;border-color:var(--ok)}

  select,input[type=search]{font:15px system-ui;padding:10px 13px;border:1px solid var(--line2);
    border-radius:9px;background:var(--surface);color:var(--ink);width:100%}
  select:focus,input:focus{outline:0;border-color:var(--accent);
    box-shadow:0 0 0 3px rgba(242,140,31,.22)}

  .grille{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:14px}
  @media(max-width:760px){.grille{grid-template-columns:1fr}
    .val{grid-template-columns:1fr;gap:4px}}

  .villes{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));
          gap:7px;max-height:340px;overflow-y:auto;padding:4px;
          border:1px solid var(--line);border-radius:9px;background:var(--bg2)}
  .ville{display:flex;align-items:center;gap:9px;background:var(--surface);
         border:1px solid var(--line);border-radius:8px;padding:7px 10px}
  .ville:has(.nom:hover){border-color:var(--accent)}
  .ville[data-actif="1"]{background:var(--accent-fort);border-color:var(--accent-fort)}
  .ville[data-actif="1"] .nom{color:#fff}
  .ville[data-fait="1"] .nom{opacity:.5;text-decoration:line-through}
  .ville input{width:16px;height:16px;margin:0;flex-shrink:0;cursor:pointer;accent-color:var(--ok)}
  .nom{flex:1;display:flex;align-items:center;justify-content:space-between;gap:8px;
       background:none;border:0;padding:0;text-align:left;cursor:pointer;
       font:14px system-ui;color:var(--ink2)}
  .nom em{font-style:normal;font-size:11.5px;opacity:.6}
  .pastille{width:7px;height:7px;border-radius:50%;background:var(--attente);flex-shrink:0}
  .ville[data-https="1"] .pastille{background:var(--ok)}

  .barre{display:flex;align-items:center;justify-content:space-between;
         gap:12px;flex-wrap:wrap;margin-bottom:12px}
  .filtres{display:inline-flex;border:1px solid var(--line2);border-radius:9px;overflow:hidden}
  .filtres button{border:0;border-right:1px solid var(--line2);background:var(--surface);
    font:600 13px system-ui;color:var(--ink2);padding:8px 15px;cursor:pointer}
  .filtres button:last-child{border-right:0}
  .filtres button:hover{background:var(--bg2)}
  .filtres button.on{background:var(--accent-fort);color:#fff}
  .compteur{font-size:13.5px;color:var(--ink3)}
  .compteur b{color:var(--ink);font-variant-numeric:tabular-nums}
  .reinit{background:none;border:0;color:var(--ink3);font:13px system-ui;
          cursor:pointer;text-decoration:underline}
  .reinit:hover{color:var(--accent-fort)}

  .etape{border-left:3px solid var(--accent);padding:2px 0 2px 16px;margin:22px 0}
  .etape h3{font-size:16px;margin-bottom:3px}
  .etape p{color:var(--ink3);font-size:13.5px;margin-bottom:8px}
  .note{background:var(--accent-doux);border-radius:9px;padding:12px 15px;
        font-size:13.5px;color:#7a3d00;margin-top:10px}

  .fin{display:flex;align-items:center;gap:14px;flex-wrap:wrap;
       margin-top:26px;padding-top:22px;border-top:1px solid var(--line)}
  .termine{border:0;border-radius:10px;cursor:pointer;
           font:600 15px system-ui;padding:13px 26px;
           background:var(--accent-fort);color:#fff}
  .termine:hover{background:#a34e00}
  .termine.fait{background:var(--ok)}
  .termine.fait:hover{background:#25845c}
  .suivante{background:none;border:0;color:var(--accent-fort);cursor:pointer;
            font:600 14px system-ui;text-decoration:underline}
  .suivante:hover{color:var(--ink)}
  .fin .info{font-size:13.5px;color:var(--ink3)}
  .vide{color:var(--ink3);font-size:14.5px;padding:28px 0;text-align:center}
</style>
</head>
<body>
<div class="page">

  <h1>Mise en ligne — ${METIER}</h1>
  <p class="sous">Choisir un département puis une commune pour obtenir les commandes et les valeurs à saisir dans cPanel. Page hors ligne, générée depuis l'état local du projet.</p>

  <div class="bloc">
    <h2>Avant tout — autoriser l'IP</h2>
    <p style="color:var(--ink3);font-size:14px;margin-bottom:6px">L'IP publique change souvent : sans elle en liste blanche, <code>ssh</code> et <code>deploy.sh</code> partent en timeout.</p>
    <div class="cmd"><code>curl -s https://ifconfig.me; echo</code><button data-copie="curl -s https://ifconfig.me; echo">copier</button></div>
    <div class="note">Coller le résultat dans <b>cPanel → Autorisation SSH</b>. Cette page accepte aussi un nom DynDNS, qui évite d'y revenir à chaque changement d'IP.</div>
    <div class="cmd"><code>ssh o2 'echo OK'</code><button data-copie="ssh o2 'echo OK'">copier</button></div>
  </div>

  <div class="bloc">
    <h2>Vider le cache DNS</h2>
    <p style="color:var(--ink3);font-size:14px;margin-bottom:6px">macOS mémorise l'<b>absence</b> d'un sous-domaine interrogé avant sa création. Le site répond alors « serveur introuvable » alors qu'il est en ligne, et les contrôles de certificat concluent à tort « pas de certificat ».</p>
    <div class="cmd"><code>sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder</code><button data-copie="sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder">copier</button></div>
    <div class="note">À lancer après avoir déclaré un sous-domaine, avant d'ouvrir son URL. Le réflexe qui évite le problème : ne pas visiter l'adresse tant que le sous-domaine n'est pas créé.</div>
  </div>

  <div class="bloc">
    <h2>Département et commune</h2>
    <div class="grille">
      <select id="dep"></select>
      <input type="search" id="rech" placeholder="Filtrer une commune…" autocomplete="off">
    </div>
    <div class="barre">
      <div class="filtres">
        <button data-f="tous" class="on">Toutes</button>
        <button data-f="afaire">À faire</button>
        <button data-f="faites">Faites</button>
      </div>
      <span class="compteur" id="compteur"></span>
      <button class="reinit" id="reinit">réinitialiser le suivi</button>
    </div>
    <div class="villes" id="villes"></div>
    <p style="color:var(--ink3);font-size:12.5px;margin-top:9px">
      Cocher une commune la marque comme faite — le suivi reste dans ce navigateur.
      <span class="pastille" style="display:inline-block;vertical-align:middle;background:var(--ok)"></span>
      pastille verte = redirection HTTPS constatée sur le serveur &nbsp;·&nbsp; triées par population
    </p>
  </div>

  <div id="fiche"></div>

</div>

<script>
const D = ${DONNEES};

const el = (h) => { const d=document.createElement('div'); d.innerHTML=h.trim(); return d.firstChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const cmd = (c) => \`<div class="cmd"><code>\${esc(c)}</code><button data-copie="\${esc(c)}">copier</button></div>\`;
const val = (label, v) => \`<div class="val"><span>\${esc(label)}</span><b>\${esc(v)}</b><button data-copie="\${esc(v)}">copier</button></div>\`;

const selDep = document.getElementById('dep');
const zoneVilles = document.getElementById('villes');
const rech = document.getElementById('rech');
const fiche = document.getElementById('fiche');

D.departements.forEach((d,i) => {
  const o = document.createElement('option');
  o.value = i; o.textContent = \`\${d.nom} (\${d.dep}) — \${d.communes.length} communes\`;
  selDep.appendChild(o);
});

let iDep = 0, slugActif = null, filtre = 'tous';

/* Suivi des communes traitées, conservé dans ce navigateur.
   Les communes dont la redirection est constatée côté serveur (.https-actives)
   sont fusionnées à chaque chargement : l'état réel prime toujours sur la coche. */
const cle = () => 'cmd:' + D.metier + ':' + D.departements[iDep].rel;
let faites = new Set();

function chargerFaites() {
  const d = D.departements[iDep];
  let stocke = [];
  try { stocke = JSON.parse(localStorage.getItem(cle()) || '[]'); } catch (_) {}
  faites = new Set([...stocke, ...d.https]);
}
function enregistrerFaites() {
  try { localStorage.setItem(cle(), JSON.stringify([...faites])); } catch (_) {}
}

function listeVilles() {
  const d = D.departements[iDep];
  const q = rech.value.trim().toLowerCase();
  zoneVilles.innerHTML = '';

  const vues = d.communes.filter(c => {
    if (q && !c.nom.toLowerCase().includes(q) && !c.slug.includes(q)) return false;
    if (filtre === 'afaire') return !faites.has(c.slug);
    if (filtre === 'faites') return faites.has(c.slug);
    return true;
  });

  const nbFaites = d.communes.filter(c => faites.has(c.slug)).length;
  document.getElementById('compteur').innerHTML =
    \`<b>\${nbFaites}</b> / \${d.communes.length} faites · <b>\${d.communes.length - nbFaites}</b> restantes\`;

  if (!vues.length) {
    zoneVilles.innerHTML = '<p class="vide">' +
      (filtre === 'afaire' ? 'Tout est fait pour ce département.' : 'Aucune commune ne correspond.') +
      '</p>';
    return;
  }

  vues.forEach(c => {
    const surServeur = d.https.includes(c.slug) ? '1' : '0';
    const fait = faites.has(c.slug) ? '1' : '0';
    const ligne = el(\`<div class="ville" data-https="\${surServeur}" data-fait="\${fait}"
                          data-actif="\${c.slug === slugActif ? 1 : 0}">
        <input type="checkbox" \${fait === '1' ? 'checked' : ''}
               title="Marquer comme faite" aria-label="\${esc(c.nom)} : faite">
        <button class="nom"><span><span class="pastille"></span> \${esc(c.nom)}</span>
        <em>\${c.pop ? c.pop.toLocaleString('fr-FR') : ''}</em></button></div>\`);

    ligne.querySelector('input').addEventListener('change', e => {
      if (e.target.checked) faites.add(c.slug); else faites.delete(c.slug);
      enregistrerFaites();
      listeVilles();
    });
    ligne.querySelector('.nom').addEventListener('click', () => {
      slugActif = c.slug; listeVilles(); afficher(c);
    });
    zoneVilles.appendChild(ligne);
  });
}

document.querySelectorAll('.filtres button').forEach(b => {
  b.addEventListener('click', () => {
    filtre = b.dataset.f;
    document.querySelectorAll('.filtres button').forEach(x => x.classList.toggle('on', x === b));
    listeVilles();
  });
});

document.getElementById('reinit').addEventListener('click', () => {
  const d = D.departements[iDep];
  if (!confirm(\`Effacer le suivi de \${d.nom} ?\\nLes communes déjà en HTTPS sur le serveur resteront cochées.\`)) return;
  try { localStorage.removeItem(cle()); } catch (_) {}
  chargerFaites();
  listeVilles();
});

function afficher(c) {
  const d = D.departements[iDep];
  const hote = \`\${c.slug}.\${d.domain}\`;
  const racine = \`sites/\${d.domain}/villes\`;
  const dejaHttps = d.https.includes(c.slug);

  fiche.innerHTML = '';
  fiche.appendChild(el(\`
    <div class="bloc">
      <h2>\${esc(c.nom)} — \${esc(hote)}</h2>

      <div class="etape">
        <h3>0 · Où en est cette commune</h3>
        <p>Affiche l'état des 4 étapes et indique la suivante.</p>
        \${cmd(\`./golive.sh \${d.rel} \${c.slug}\`)}
      </div>

      <div class="etape">
        <h3>1 · Déployer le contenu</h3>
        <p>Envoie le socle commun puis cette commune seule. Les autres ne sont pas touchées.</p>
        \${cmd(\`./golive.sh \${d.rel} \${c.slug} --deploy\`)}
      </div>

      <div class="etape">
        <h3>2 · Déclarer le sous-domaine</h3>
        <p>cPanel → Domaines → Créer un domaine</p>
        \${val('Domaine', c.slug)}
        \${val('Domaine racine', d.domain)}
        \${val('Répertoire racine', racine)}
        \${val('Partager le répertoire racine', 'DÉCOCHÉ')}

        <div class="note"><b>Le champ Domaine ne prend que le nom de la ville</b>,
        pas l'adresse complète. cPanel ajoute le domaine racine lui-même — résultat attendu :
        <b>\${esc(hote)}</b>.<br>
        Y saisir <b>\${esc(hote)}</b> donnerait <b>\${esc(hote)}.\${esc(D.user)}.odns.fr</b>,
        et le certificat échouerait ensuite sur une erreur CAA.</div>

        <div class="note">La racine est <b>villes</b>, sans <b>/\${esc(c.slug)}</b> : le routeur lit le nom d'hôte et sert le bon dossier. C'est ce qui permet de mutualiser les assets.</div>

        <p style="margin-top:12px">Ou en ligne de commande, sans ambiguïté possible :</p>
        \${cmd(\`ssh o2 "uapi SubDomain addsubdomain domain='\${c.slug}' rootdomain='\${d.domain}' dir='/sites/\${d.domain}/villes'"\`)}
      </div>

      <div class="etape">
        <h3>3 · Émettre le certificat</h3>
        <p>cPanel → SSL/TLS → Let's Encrypt™</p>
        \${val('Domaine', hote)}
        \${val('Validation', 'http-01')}
        \${val('Inclure le wildcard', 'NON')}
        <div class="note"><b>Plafond : 50 certificats par domaine racine sur 168 h glissantes.</b> Atteint, le refus indique l'heure exacte de déblocage — s'y fier plutôt que compter. Seules les émissions réussies comptent : un échec ne coûte rien, inutile de simuler.</div>
      </div>

      <div class="etape">
        <h3>4 · Activer la redirection HTTP → HTTPS</h3>
        <p>\${dejaHttps ? 'Déjà active pour cette commune.' : 'Refusé tant que le certificat n\\'est pas reconnu.'}</p>
        \${cmd(\`./golive.sh \${d.rel} \${c.slug} --https\`)}
        \${cmd(\`./build.sh \${d.rel} && ./deploy.sh \${d.rel} _villes\`)}
      </div>

      <div class="etape">
        <h3>Vérifier</h3>
        \${cmd(\`curl -sI https://\${hote}/ | head -1\`)}
        \${cmd(\`./ssl-check.sh \${d.rel}\`)}
      </div>

      <div class="fin">
        <button class="termine\${faites.has(c.slug) ? ' fait' : ''}" id="btnFini">
          \${faites.has(c.slug) ? '✓ Terminée — annuler' : 'Marquer comme terminée'}
        </button>
        <span class="info" id="infoFini"></span>
      </div>
    </div>\`));

  // Même effet que la case à cocher de la liste, mais au bout des étapes :
  // on ne remonte pas chercher la ligne après avoir déroulé la procédure.
  const btn = document.getElementById('btnFini');
  btn.addEventListener('click', () => {
    if (faites.has(c.slug)) faites.delete(c.slug); else faites.add(c.slug);
    enregistrerFaites();
    listeVilles();
    afficher(c);

    // Proposer la suivante à traiter, dans l'ordre de la liste
    if (faites.has(c.slug)) {
      const suiv = D.departements[iDep].communes.find(x => !faites.has(x.slug));
      const info = document.getElementById('infoFini');
      if (suiv) {
        info.innerHTML = 'Suivante : ';
        const a = document.createElement('button');
        a.className = 'suivante';
        a.textContent = suiv.nom + ' →';
        a.onclick = () => { slugActif = suiv.slug; listeVilles(); afficher(suiv); };
        info.appendChild(a);
      } else {
        info.textContent = 'Toutes les communes du département sont faites.';
      }
    }
  });

  fiche.scrollIntoView({ behavior:'smooth', block:'start' });
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-copie]');
  if (!b) return;
  navigator.clipboard.writeText(b.dataset.copie).then(() => {
    const t = b.textContent; b.textContent = 'copié'; b.classList.add('ok');
    setTimeout(() => { b.textContent = t; b.classList.remove('ok'); }, 1200);
  });
});

selDep.addEventListener('change', () => {
  iDep = +selDep.value; slugActif = null; fiche.innerHTML = '';
  chargerFaites(); listeVilles();
});
rech.addEventListener('input', listeVilles);
chargerFaites();
listeVilles();
</script>
</body>
</html>`;

const out = path.join(metierDir, 'cmd.html');
fs.writeFileSync(out, html, 'utf8');
const total = departements.reduce((n, d) => n + d.communes.length, 0);
console.log(`✅ ${path.relative(ROOT, out)} — ${departements.length} département(s), ${total} communes`);
console.log(`   open ${path.relative(ROOT, out)}`);
