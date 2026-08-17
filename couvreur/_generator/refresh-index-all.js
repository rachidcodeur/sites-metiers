#!/usr/bin/env node
/**
 * Régénère et redéploie UNIQUEMENT les index.html pour tous les départements
 * listés dans regroupements_departements.csv.
 *
 * Ne touche pas aux CSS/images/JS déjà déployés sur le serveur.
 *
 * Usage :
 *   node refresh-index-all.js                    # défaut : génère + déploie
 *   node refresh-index-all.js --generate-only    # seulement la génération locale
 *   node refresh-index-all.js --deploy-only      # seulement le déploiement (output/ doit exister)
 *   node refresh-index-all.js --server ubuntu@137.74.112.253
 *   node refresh-index-all.js --only "33,75,01"  # liste de dépts à traiter
 *   node refresh-index-all.js --skip "75"        # liste de dépts à exclure
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const argVal = n => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1]; };
const GENERATE_ONLY = args.includes('--generate-only');
const DEPLOY_ONLY   = args.includes('--deploy-only');
const SERVER = argVal('--server') || 'ubuntu@137.74.112.253';
const ONLY  = argVal('--only')?.split(',').map(s => s.trim()).filter(Boolean);
const SKIP  = (argVal('--skip')?.split(',').map(s => s.trim()).filter(Boolean)) || [];

const ROOT = __dirname;
const csv = fs.readFileSync(path.join(ROOT, 'regroupements_departements.csv'), 'utf8');

// Parse CSV → liste {code, nom}
const depts = [];
csv.split('\n').slice(1).forEach(line => {
  const trimmed = line.trim();
  if (!trimmed) return;
  const [, code, nom] = trimmed.split(';');
  if (!code || !nom) return;
  if (ONLY && !ONLY.includes(code)) return;
  if (SKIP.includes(code)) return;
  depts.push({ code, nom });
});

console.log(`\n🎯  ${depts.length} département(s) à traiter\n`);

function run(cmd, label) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    console.error(`❌  Échec ${label} :`, e.message);
    process.exit(1);
  }
}

let i = 0;
const start = Date.now();
for (const { code, nom } of depts) {
  i++;
  const label = `[${i}/${depts.length}] dept ${code} (${nom})`;
  console.log(`\n━━━━━ ${label} ━━━━━`);

  if (!DEPLOY_ONLY) {
    run(`node generate-dep.js --dep ${code} --dep-nom "${nom}" --index-only`, `generate-dep ${code}`);
    run(`node generate.js     --dep ${code} --dep-nom "${nom}" --index-only`, `generate ${code}`);
  }
  if (!GENERATE_ONLY) {
    run(`node deploy.js --dep ${code} --dep-nom "${nom}" --with-dep --server ${SERVER}`, `deploy ${code}`);
  }
}

const elapsed = Math.round((Date.now() - start) / 1000);
console.log(`\n✅  Terminé en ${Math.floor(elapsed/60)}m ${elapsed%60}s · ${depts.length} dépt(s) traités\n`);
