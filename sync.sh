#!/usr/bin/env bash
#
# Cycle complet de mise à jour, en une commande.
#
#   ./sync.sh                      tous les départements de tous les métiers
#   ./sync.sh peintre/gironde      un seul
#   ./sync.sh --local              régénère et vérifie, sans rien envoyer
#
# Enchaîne : git pull -> build -> deploy -> régénération des tableaux de bord.
# Conçu pour le travail à plusieurs : chacun tire les changements des autres,
# reconstruit à partir des sources, puis publie sa part.
#
# Ce qui n'est PAS versionné et doit exister localement :
#   <metier>/.env    clés Supabase — demander à un membre de l'équipe
#   ~/.ssh/config    les blocs Host des comptes cPanel (voir §5 de la doc)

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

rouge=$'\033[31m'; vert=$'\033[32m'; jaune=$'\033[33m'; gris=$'\033[90m'; raz=$'\033[0m'
[[ -t 1 ]] || { rouge=''; vert=''; jaune=''; gris=''; raz=''; }

CIBLE=""; LOCAL_SEUL=0
for a in "$@"; do
  case "$a" in
    --local) LOCAL_SEUL=1 ;;
    -*)      echo "Option inconnue : $a" >&2; exit 1 ;;
    *)       CIBLE="${a%/}" ;;
  esac
done

titre() { echo ""; echo "${jaune}── $1${raz}"; }

# ─── 1. Récupérer le travail des autres ──────────────────────────────────────
titre "Mise à jour du dépôt"
if git rev-parse --git-dir >/dev/null 2>&1; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "  ${jaune}Modifications locales non validées :${raz}"
    git status --short | head -8 | sed 's/^/    /'
    echo "  ${gris}Les valider ou les mettre de côté avant de tirer.${raz}"
  fi
  if git remote | grep -q .; then
    git pull --rebase --autostash 2>&1 | sed 's/^/  /'
  else
    echo "  ${gris}Aucun dépôt distant configuré — étape ignorée.${raz}"
  fi
else
  echo "  ${gris}Pas un dépôt git — étape ignorée.${raz}"
fi

# ─── 2. Prérequis locaux ─────────────────────────────────────────────────────
titre "Prérequis"
manque=0
for m in */; do
  m="${m%/}"
  [[ -d "$m/_generator" ]] || continue
  if [[ -f "$m/.env" ]]; then
    printf '  %-12s .env présent\n' "$m"
  else
    printf '  %-12s %s\n' "$m" "${rouge}.env MANQUANT — les formulaires ne pourront pas envoyer${raz}"
    manque=1
  fi
done
[[ $manque -eq 1 ]] && echo "  ${gris}Demander le .env à un membre de l'équipe : il n'est pas versionné.${raz}"

# ─── 3. Départements à traiter ───────────────────────────────────────────────
SITES=()
if [[ -n "$CIBLE" ]]; then
  [[ -f "$ROOT/$CIBLE/.site" ]] || { echo "${rouge}Introuvable : $CIBLE/.site${raz}" >&2; exit 1; }
  SITES+=("$CIBLE")
else
  while IFS= read -r f; do
    SITES+=("$(dirname "${f#"$ROOT"/}")")
  done < <(find "$ROOT" -mindepth 3 -maxdepth 3 -name .site | sort)
fi
[[ ${#SITES[@]} -gt 0 ]] || { echo "${rouge}Aucun département configuré.${raz}" >&2; exit 1; }

# ─── 4. Construire ───────────────────────────────────────────────────────────
echec=0
for s in "${SITES[@]}"; do
  titre "Construction — $s"
  if bash "$ROOT/build.sh" "$s" > /tmp/sync-build.txt 2>&1; then
    grep -E 'communes |fichiers total|https _|ATTENTION' /tmp/sync-build.txt | sed 's/^/  /'
  else
    echo "  ${rouge}échec${raz}"; tail -5 /tmp/sync-build.txt | sed 's/^/    /'; echec=1
  fi
done
[[ $echec -eq 1 ]] && { echo ""; echo "${rouge}Construction en échec — rien n'est déployé.${raz}"; exit 1; }

# ─── 5. Publier ──────────────────────────────────────────────────────────────
if [[ $LOCAL_SEUL -eq 1 ]]; then
  titre "Mode --local : rien n'est envoyé"
else
  for s in "${SITES[@]}"; do
    titre "Déploiement — $s"
    bash "$ROOT/deploy.sh" "$s" 2>&1 \
      | grep -vE 'post-quantum|store now|openssh.com/pq' \
      | grep -E '^===|^-->|deleting|Number of files|Terminé|Connexion SSH|cPanel|curl -s' \
      | sed 's/^/  /'
  done
fi

# ─── 6. Tableaux de bord ─────────────────────────────────────────────────────
titre "Tableaux de bord"
for m in */; do
  m="${m%/}"
  [[ -d "$m/_generator" ]] || continue
  node "$ROOT/make-cmd.js" "$m" 2>&1 | sed 's/^/  /'
done
node "$ROOT/make-dashboard.js" 2>&1 | sed 's/^/  /'

echo ""
echo "${vert}Terminé.${raz}"
echo "${gris}Penser à valider et pousser : git add -A && git commit -m '…' && git push${raz}"
