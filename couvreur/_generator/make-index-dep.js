#!/usr/bin/env node
/**
 * Dérive index-dep.html depuis index.html.
 *
 *   node make-index-dep.js
 *
 * Les deux pages partagent le même design : le départemental n'est que la page
 * commune, plus une section listant les communes du département. Le dériver au
 * lieu de le maintenir à part évite la divergence qui a déjà cassé ce site une
 * fois (variables.json et style.css partagés sans l'être vraiment).
 *
 * À relancer après CHAQUE modification de index.html.
 */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const src = path.join(dir, 'index.html');
const dst = path.join(dir, 'index-dep.html');

let tpl = fs.readFileSync(src, 'utf8');

// Plus aucune section propre au départemental : la page est identique à celle
// d'une commune. Le fichier reste pour pouvoir réintroduire une différence
// sans refaire toute la mécanique.

fs.writeFileSync(dst, tpl, 'utf8');

const slots = new Set(tpl.match(/\{\{[A-Z0-9_]+\}\}/g) || []);
console.log(`✅ index-dep.html dérivé de index.html — ${slots.size} placeholders`);
