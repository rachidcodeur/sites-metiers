#!/usr/bin/env bash
#
# Génération d'un département, puis mise en forme pour le déploiement o2switch.
#
#   ./build.sh couvreur/gironde
#   ./build.sh couvreur/gironde && ./deploy.sh couvreur/gironde
#
# Ce script ne déploie rien. Il remplit _root/ et _villes/ à partir de la
# sortie brute du générateur, puis installe le routeur .htaccess.
#
# Structure attendue :
#
#   ~/Desktop/Coding/Sites-O2Switch/
#   ├── build.sh
#   ├── deploy.sh
#   ├── _shared/htaccess-villes.tpl
#   └── couvreur/
#       ├── _generator/        <- le générateur du métier (une seule copie)
#       │   └── output/        <- sortie brute, jamais déployée
#       └── gironde/
#           ├── .site          DOMAIN= / DEP= / DEP_NOM=
#           ├── _root/         <- site départemental
#           └── _villes/       <- les communes

set -euo pipefail

ROOT="$HOME/Desktop/Coding/Sites-O2Switch"
TPL="$ROOT/_shared/htaccess-villes.tpl"       # routeur du vhost wildcard
TPL_ROOT="$ROOT/_shared/htaccess-root.tpl"    # apex : redirections canoniques
TPL_404="$ROOT/_shared/404.html"              # page 404 commune aux deux vhosts

REL="${1:?usage: $0 <metier/departement>}"
REL="${REL%/}"
SITE="$ROOT/$REL"
METIER="${REL%%/*}"
SLUG="$(basename "$REL")"
GEN="$ROOT/$METIER/_generator"

[[ -d "$GEN" ]]        || { echo "Générateur introuvable : $GEN" >&2; exit 1; }
[[ -f "$TPL" ]]        || { echo "Modèle .htaccess introuvable : $TPL" >&2; exit 1; }
[[ -f "$TPL_ROOT" ]]   || { echo "Modèle .htaccess apex introuvable : $TPL_ROOT" >&2; exit 1; }
[[ -f "$TPL_404" ]]    || { echo "Page 404 introuvable : $TPL_404" >&2; exit 1; }
[[ -f "$SITE/.site" ]] || { echo "Fichier .site manquant dans $SITE" >&2; exit 1; }

# shellcheck disable=SC1090
source "$SITE/.site"
: "${DOMAIN:?DOMAIN non défini dans .site}"
: "${DEP:?DEP non défini dans .site}"
: "${DEP_NOM:?DEP_NOM non défini dans .site}"

DEP_OUT="$GEN/output/${DEP}-${SLUG}-dep"   # sortie du site départemental
VILLES_OUT="$GEN/output/${DEP}-${SLUG}"    # <-- AJUSTER si le générateur
                                           #     nomme ce dossier autrement

echo "=== ${METIER} / ${DEP_NOM} (${DEP}) -> ${DOMAIN} ==="

# La sortie du générateur est cumulative : il écrit par-dessus sans jamais
# supprimer. Sans purge, les assets copiés par commune avant la mutualisation
# (§7) survivraient à la regénération et repartiraient dans _villes.
# Le chemin est vérifié avant suppression : jamais de rm -rf sur une variable vide.
for d in "$DEP_OUT" "$VILLES_OUT"; do
  case "$d" in
    "$GEN/output/"?*) rm -rf "$d" ;;
    *) echo "Chemin de sortie inattendu, purge annulée : $d" >&2; exit 1 ;;
  esac
done

cd "$GEN"
node generate-dep.js --dep "$DEP" --dep-nom "$DEP_NOM" --domain "$DOMAIN"
# --domain fait foi pour les canonical et les sitemaps : sans lui le générateur
# retombe sur son ancien schéma couvreurXX-pro.fr, qui n'est pas le domaine o2switch.
node generate.js --dep "$DEP" --dep-nom "$DEP_NOM" --domain "$DOMAIN" --depdir "output/${DEP}-${SLUG}-dep"

[[ -d "$DEP_OUT" ]]    || { echo "Sortie départementale introuvable : $DEP_OUT" >&2; exit 1; }
[[ -d "$VILLES_OUT" ]] || { echo "Sortie communes introuvable : $VILLES_OUT" >&2; exit 1; }

echo ""
echo "=== Mise en forme ==="

mkdir -p "$SITE/_root" "$SITE/_villes"

# Site départemental -> _root (le .htaccess est posé juste après, pas généré ici)
rsync -a --delete --exclude '.htaccess' "$DEP_OUT/" "$SITE/_root/"

# Communes -> _villes, en préservant le routeur.
# La mutualisation des assets est faite par le générateur : il écrit un unique
# dossier assets/ à la racine de sa sortie et référence /assets/… en absolu dans
# le HTML (voir PROJET-O2SWITCH.md §7). Ce rsync le recopie tel quel — ne pas
# réintroduire d'--exclude 'assets/', il empêcherait sa mise à jour.
rsync -a --delete \
  --exclude '.htaccess' \
  "$VILLES_OUT/" "$SITE/_villes/"

# Redirection HTTPS des communes : sélective, pilotée par le fichier
# .https-actives (un slug de commune par ligne). Une commune n'y entre que si son
# certificat a été VÉRIFIÉ — c'est golive.sh qui l'y ajoute, jamais à la main.
# Liste vide ou absente = aucune redirection. Jamais de bascule globale.
ACTIVES="$SITE/.https-actives"
HTTPS_HOSTS=""
if [[ -f "$ACTIVES" ]]; then
  HTTPS_HOSTS="$( { grep -vE '^\s*(#|$)' "$ACTIVES" || true; } | tr -d ' ' | sort -u | paste -sd'|' -)"
fi
if [[ -n "$HTTPS_HOSTS" ]]; then
  HTTPS_JETON=""
else
  HTTPS_JETON="#"
  HTTPS_HOSTS="__aucune__"      # jamais atteint, la règle est commentée
fi

# Routeur .htaccess généré depuis le modèle, regex adaptée au domaine
DOMAIN_REGEX="${DOMAIN//./\\.}"
sed -e "s/__DOMAIN_REGEX__/${DOMAIN_REGEX}/g" \
    -e "s/__HTTPS_HOSTS__/${HTTPS_HOSTS}/g" \
    -e "s/__HTTPS__/${HTTPS_JETON}/g" "$TPL" > "$SITE/_villes/.htaccess"

# .htaccess de l'apex : redirection indépendante des communes, l'apex ayant son
# propre certificat. Pilotée par HTTPS_REDIRECT_ROOT dans .site.
if [[ "${HTTPS_REDIRECT_ROOT:-0}" == "1" ]]; then ROOT_JETON=""; else ROOT_JETON="#"; fi
sed -e "s/__HTTPS__/${ROOT_JETON}/g" "$TPL_ROOT" > "$SITE/_root/.htaccess"

# Page 404 — référencée par ErrorDocument dans les deux .htaccess.
# Absente, Apache sert sa page par défaut sur toute commune inexistante.
cp "$TPL_404" "$SITE/_root/404.html"
cp "$TPL_404" "$SITE/_villes/404.html"

# Permissions normalisées ICI, pas au déploiement : l'arborescence locale doit
# déjà être juste. Certaines images arrivent en 664 (écriture pour le groupe),
# ce qui n'a rien à faire sur un mutualisé. openrsync ne sachant pas faire
# --chmod, c'est la seule façon d'avoir des droits déterministes en ligne.
find "$SITE/_root" "$SITE/_villes" -type d -exec chmod 755 {} +
find "$SITE/_root" "$SITE/_villes" -type f -exec chmod 644 {} +

echo ""
echo "=== Contrôle ==="
printf "communes       : %s\n" "$(find "$SITE/_villes" -mindepth 1 -maxdepth 1 -type d ! -name assets | wc -l | tr -d ' ')"
printf "fichiers total : %s\n" "$(find "$SITE/_root" "$SITE/_villes" -type f | wc -l | tr -d ' ')"
printf "poids _villes  : %s\n" "$(du -sh "$SITE/_villes" | cut -f1)"
printf "routeur        : %s\n" "$([[ -f "$SITE/_villes/.htaccess" ]] && echo OK || echo MANQUANT)"

printf "assets partagés: %s\n" "$([[ -f "$SITE/_villes/assets/style.css" ]] && echo OK || echo MANQUANT)"

# État de la redirection HTTPS — le point à surveiller pour l'indexation :
# tant qu'elle est inactive, le site répond en http et Google peut l'indexer.
https_etat() {
  local f="$1"
  if grep -qE '^\s*RewriteRule .*https://' "$f" 2>/dev/null; then echo "ACTIVE"
  else echo "inactive (à activer après le certificat)"; fi
}
printf "https _villes  : %s\n" "$(https_etat "$SITE/_villes/.htaccess")"
printf "https _root    : %s\n" "$(https_etat "$SITE/_root/.htaccess")"

# Placeholders non substitués : ils s'affichent tels quels sur la page publique.
# Arrive dès qu'un template et son data/variables*.json divergent — c'est ce qui
# s'est produit en remplaçant le template commune sans découpler le départemental.
PH="$( { grep -roh --include='*.html' '{{[A-Z0-9_]*}}' "$SITE/_root" "$SITE/_villes" 2>/dev/null || true; } | sort -u)"
if [[ -n "$PH" ]]; then
  echo "ATTENTION : placeholders non substitués dans les pages générées :"
  sed 's/^/    /' <<<"$PH" | head -10
  [[ "$(wc -l <<<"$PH")" -gt 10 ]] && echo "    … et d'autres"
fi

# Un canonical qui pointe ailleurs annule tout le travail d'indexation.
BAD_CANON="$( { grep -rl --include='*.html' 'rel="canonical"' "$SITE/_root" "$SITE/_villes" 2>/dev/null | xargs grep -L "canonical\" href=\"https://[a-z0-9.-]*${DOMAIN}" 2>/dev/null || true; } | wc -l | tr -d ' ')"
[[ "$BAD_CANON" -gt 0 ]] && echo "ATTENTION : $BAD_CANON page(s) avec un canonical hors de $DOMAIN"

# Garde-fou §7 : un asset partagé référencé en relatif serait cherché dans le
# dossier de la commune, que la mutualisation a justement vidé.
# `|| true` obligatoire : grep sort en 1 quand il ne trouve rien, et pipefail
# ferait échouer tout le script sur le cas nominal.
REL_REFS="$( { grep -rl --include='index.html' -e '="style\.css"' -e '="public/js/' "$SITE/_villes" 2>/dev/null || true; } | wc -l | tr -d ' ')"
if [[ "$REL_REFS" -gt 0 ]]; then
  echo "ATTENTION : $REL_REFS page(s) référencent des assets partagés en relatif — voir §7"
fi

# Budget fichiers : 100 000 par compte cPanel, tous départements et métiers confondus.
NB_FICHIERS="$(find "$SITE/_root" "$SITE/_villes" -type f | wc -l | tr -d ' ')"
printf "budget         : %s fichiers/dep -> %s pour 95 dep\n" "$NB_FICHIERS" "$((NB_FICHIERS * 95))"

# Images propres à une ville : légitimes, mais elles échappent à la mutualisation
OVERRIDES="$(find "$SITE/_villes" -mindepth 2 -path '*/public/images/*' -type f | wc -l | tr -d ' ')"
[[ "$OVERRIDES" -gt 0 ]] && printf "overrides ville: %s image(s) non mutualisées\n" "$OVERRIDES"

echo ""
echo "Prêt. Vérifier puis :  DRY=1 ./deploy.sh $REL"
