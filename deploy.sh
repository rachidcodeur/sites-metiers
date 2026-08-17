#!/usr/bin/env bash
#
# Déploiement de sites statiques vers o2switch — architecture wildcard.
#
#   ./deploy.sh couvreur/gironde           -> déploie _root + _villes
#   ./deploy.sh couvreur/gironde _villes   -> déploie uniquement les communes
#   ./deploy.sh --all                      -> déploie tous les sites trouvés
#   DRY=1 ./deploy.sh couvreur/gironde     -> simulation, rien n'est écrit
#
# Structure locale :
#
#   ~/Desktop/Coding/Sites-O2Switch/
#   ├── deploy.sh
#   └── couvreur/
#       ├── gironde/
#       │   ├── .site           -> DOMAIN="couvreur-gironde-33.fr"
#       │   ├── _root/          -> docroot du domaine principal
#       │   └── _villes/        -> docroot du vhost "*"
#       │       ├── .htaccess   (le routeur)
#       │       ├── assets/     (mutualisés pour toutes les communes)
#       │       ├── bordeaux/
#       │       └── merignac/
#       └── charente/
#           ├── .site           -> DOMAIN="couvreur-charente-16.fr"
#           └── ...
#
# Le fichier .site contient une ligne :   DOMAIN="couvreur-gironde-33.fr"
# C'est lui qui fait le lien entre le dossier local et le domaine distant.
#
# Prérequis cPanel, une fois par domaine :
#   1. Créer le domaine        -> docroot /home/USER/sites/<domaine>/_root
#   2. Créer le sous-domaine * -> docroot /home/USER/sites/<domaine>/villes
#   3. Let's Encrypt sur "*"   -> cocher Wildcard + validation DNS

set -euo pipefail

# --- Configuration -----------------------------------------------------------
# Valeurs par DÉFAUT. Chaque .site peut les surcharger — les métiers sont
# répartis sur plusieurs comptes cPanel (« Lunes »), et le seuil des 100 000
# fichiers se compte par compte. Voir PROJET-O2SWITCH.md §2.
REMOTE_ALIAS_DEFAUT="o2"                # entrée Host de ~/.ssh/config
REMOTE_USER_DEFAUT="movi6707"
PRIMARY_DOMAIN=""                       # domaine principal du compte cPanel,
                                        # laisser vide si c'est le domaine
                                        # technique (movi6707.odns.fr)
LOCAL_ROOT="$HOME/Desktop/Coding/Sites-O2Switch"

# -----------------------------------------------------------------------------

# --- Variante de rsync -------------------------------------------------------
# macOS ne fournit plus le vrai rsync depuis Sequoia : /usr/bin/rsync est
# openrsync, qui ignore --chmod et --info. On détecte au lieu de supposer, et on
# préfère un rsync complet s'il est installé (brew install rsync).
RSYNC_BIN="${RSYNC_BIN:-}"
if [[ -z "$RSYNC_BIN" ]]; then
  for c in /opt/homebrew/bin/rsync /usr/local/bin/rsync rsync; do
    command -v "$c" >/dev/null 2>&1 || continue
    RSYNC_BIN="$(command -v "$c")"
    "$RSYNC_BIN" --version 2>&1 | head -1 | grep -qi openrsync || break
  done
fi
[[ -n "$RSYNC_BIN" ]] || { echo "rsync introuvable." >&2; exit 1; }

if "$RSYNC_BIN" --version 2>&1 | head -1 | grep -qi openrsync; then
  RSYNC_FLAVEUR="openrsync"
else
  RSYNC_FLAVEUR="rsync"
fi
# -----------------------------------------------------------------------------

RSYNC_OPTS=(
  -rlz
  --delete                      # les communes supprimées en local disparaissent
  --omit-dir-times
  --exclude '.site'             # la config locale ne part pas sur le serveur
  --exclude '.git'         --exclude '.gitignore'
  --exclude '.DS_Store'    --exclude 'Thumbs.db'
  --exclude 'node_modules' --exclude '*.map'
  --exclude '.env'         --exclude 'src/'

  # Dossiers qui appartiennent au SERVEUR : absents en local, --delete les
  # effacerait à chaque déploiement.
  #   .well-known : validation HTTP-01 de Let's Encrypt. L'effacer pendant un
  #                 renouvellement le fait échouer — et le renouvellement est
  #                 manuel, donc rien ne le rattraperait.
  #   cgi-bin     : créé d'office par cPanel, recréé sans cesse.
  --exclude '.well-known/'
  --exclude 'cgi-bin/'
)

if [[ "$RSYNC_FLAVEUR" == "openrsync" ]]; then
  # Pas de --chmod : on transmet les droits locaux, que build.sh a normalisés
  # en 755/644. Pas de --info non plus, openrsync ne connaît que --stats.
  RSYNC_OPTS+=(-p --stats)
else
  RSYNC_OPTS+=(--no-perms --no-owner --no-group --chmod=D755,F644
               --human-readable --info=progress2,stats1)
fi

[[ "${DRY:-0}" == "1" ]] && RSYNC_OPTS+=(--dry-run -v) && echo "### SIMULATION ###"

# Contrôle SSH avant tout : sans lui, rsync crache une dizaine de lignes
# d'erreurs de bas niveau qui masquent la cause réelle. L'IP publique change
# (box, VPN, 4G) et le filtrage o2switch la rejette.
verifier_ssh() {
  local REMOTE_ALIAS="$1"
  ssh -o ConnectTimeout=10 -o BatchMode=yes "$REMOTE_ALIAS" 'exit 0' 2>/dev/null && return 0

  # Deux échecs très différents, longtemps confondus par ce message :
  #   timeout          -> le port 22 est fermé, l'IP n'est pas autorisée
  #   Permission denied -> l'IP passe, c'est la CLÉ qui manque sur ce compte
  # Ces réglages sont propres à CHAQUE compte cPanel : ceux d'une Lune ne
  # valent pas pour une autre.
  local diag
  diag="$(ssh -o ConnectTimeout=10 -o BatchMode=yes "$REMOTE_ALIAS" 'exit 0' 2>&1 | tail -3)"

  echo "" >&2
  echo "Connexion SSH impossible vers « ${REMOTE_ALIAS} »." >&2
  echo "" >&2
  if grep -qi 'permission denied' <<<"$diag"; then
    cat >&2 <<EOF
L'IP est autorisée, mais le serveur refuse la clé.
  cPanel de ce compte -> Gérer les clés SSH -> Importer, puis AUTORISER
  clé publique : $(cat ~/.ssh/o2switch.pub 2>/dev/null || echo '~/.ssh/o2switch.pub introuvable')
EOF
  elif grep -qiE 'timed out|refused|no route' <<<"$diag"; then
    cat >&2 <<EOF
Le port 22 ne répond pas : l'IP publique n'est pas autorisée sur ce compte.
  1. relever l'IP : curl -s https://ifconfig.me
  2. cPanel de ce compte -> Autorisation SSH -> ajouter cette IP
EOF
  elif grep -qi 'could not resolve\|name or service' <<<"$diag"; then
    echo "Nom d'hôte introuvable : le bloc « Host ${REMOTE_ALIAS} » manque dans" >&2
    echo "~/.ssh/config (voir PROJET-O2SWITCH.md §5)." >&2
  else
    echo "$diag" >&2
  fi
  echo "" >&2
  echo "  revérifier : ssh ${REMOTE_ALIAS} 'echo OK'" >&2
  return 1
}

push() {
  local src="$1" dst="$2" REMOTE_ALIAS="$3"
  [[ -d "$src" ]] || { echo "  (ignoré, absent : $src)"; return 0; }
  echo ""
  echo "--> $(basename "$src")  =>  ${dst}"

  # Droits corrects avant l'envoi : avec openrsync ce sont eux qui partent.
  if [[ "$RSYNC_FLAVEUR" == "openrsync" && "${DRY:-0}" != "1" ]]; then
    local mauvais
    mauvais="$(find "$src" \( -type f ! -perm 644 \) -o \( -type d ! -perm 755 \) 2>/dev/null | wc -l | tr -d ' ')"
    [[ "$mauvais" -gt 0 ]] && echo "    ($mauvais entrée(s) hors 755/644 — relancer build.sh)"
  fi

  "$RSYNC_BIN" "${RSYNC_OPTS[@]}" \
    --rsync-path="mkdir -p '${dst}' && rsync" \
    "${src}/" "${REMOTE_ALIAS}:${dst}/"
}

deploy_site() {
  local rel="$1" only="${2:-}"
  local dir="${LOCAL_ROOT}/${rel}"
  local root_dst DOMAIN="" SSH_ALIAS="" CPANEL_USER=""

  [[ -d "$dir" ]]        || { echo "Dossier introuvable : $dir" >&2; return 1; }
  [[ -f "$dir/.site" ]]  || { echo "Fichier .site manquant dans $dir" >&2; return 1; }

  # shellcheck disable=SC1090
  source "$dir/.site"
  [[ -n "$DOMAIN" ]] || { echo "DOMAIN non défini dans $dir/.site" >&2; return 1; }

  # Compte cPanel et alias SSH, surchargeables par .site
  local REMOTE_ALIAS="${SSH_ALIAS:-$REMOTE_ALIAS_DEFAUT}"
  local REMOTE_USER="${CPANEL_USER:-$REMOTE_USER_DEFAUT}"
  local REMOTE_BASE="/home/${REMOTE_USER}/sites"
  local REMOTE_PUBLIC="/home/${REMOTE_USER}/public_html"
  verifier_ssh "$REMOTE_ALIAS" || return 1

  if [[ -n "$PRIMARY_DOMAIN" && "$DOMAIN" == "$PRIMARY_DOMAIN" ]]; then
    root_dst="$REMOTE_PUBLIC"
  else
    root_dst="${REMOTE_BASE}/${DOMAIN}/_root"
  fi

  echo ""
  echo "=== ${rel}  ->  ${DOMAIN}   [${RSYNC_FLAVEUR} · ${REMOTE_USER}] ==="

  if [[ -z "$only" || "$only" == "_root" ]]; then
    push "${dir}/_root"   "$root_dst" "$REMOTE_ALIAS"
  fi
  if [[ -z "$only" || "$only" == "_villes" ]]; then
    push "${dir}/_villes" "${REMOTE_BASE}/${DOMAIN}/villes" "$REMOTE_ALIAS"
  fi
}

if [[ "${1:-}" == "--all" ]]; then
  while IFS= read -r conf; do
    rel="${conf#"$LOCAL_ROOT"/}"
    deploy_site "${rel%/.site}"
  done < <(find "$LOCAL_ROOT" -name .site -type f | sort)
elif [[ -n "${1:-}" ]]; then
  deploy_site "${1%/}" "${2:-}"
else
  echo "usage: $0 <metier/departement> [_root|_villes]  |  $0 --all" >&2
  exit 1
fi

echo ""
echo "Terminé."
