#!/usr/bin/env bash
#
# Sous-domaines déclarés un par un dans cPanel — un vhost réel par commune.
#
#   ./subdomains.sh couvreur/gironde             état : déclarés / manquants
#   ./subdomains.sh couvreur/gironde --create    crée les manquants
#   ./subdomains.sh couvreur/gironde --remove-wildcard   retire le vhost "*"
#
# POURQUOI un vhost par commune : un certificat ne peut être installé que sur un
# vhost déclaré. 249 certificats distincts imposent donc 249 vhosts.
#
# POURQUOI un document root COMMUN (villes/) et non un par commune : les assets
# sont mutualisés à la racine de ce docroot (§7). Avec un docroot par commune,
# /assets/ ne serait plus joignable et il faudrait recopier les 15 fichiers dans
# chaque commune — 380 000 fichiers sur 95 départements, soit près de 4 fois le
# seuil de sauvegarde d'o2switch. Le routeur .htaccess lit HTTP_HOST et sert le
# bon dossier : chaque sous-domaine reste un site distinct vu de l'extérieur.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Défaut, surchargeable par .site (SSH_ALIAS / CPANEL_USER)
REMOTE_ALIAS="o2"

rouge=$'\033[31m'; vert=$'\033[32m'; jaune=$'\033[33m'; gris=$'\033[90m'; raz=$'\033[0m'
[[ -t 1 ]] || { rouge=''; vert=''; jaune=''; gris=''; raz=''; }

REL="${1:-}"
[[ -n "$REL" ]] || { echo "usage: $0 <metier/departement> [--create|--remove-wildcard]" >&2; exit 1; }
REL="${REL%/}"
ACTION="${2:-status}"

SITE="$ROOT/$REL"
[[ -f "$SITE/.site" ]] || { echo "Fichier .site manquant dans $SITE" >&2; exit 1; }
DOMAIN=""; SSH_ALIAS=""; CPANEL_USER=""
# shellcheck disable=SC1090
source "$SITE/.site"
[[ -n "$DOMAIN" ]] || { echo "DOMAIN non défini dans $SITE/.site" >&2; exit 1; }
REMOTE_ALIAS="${SSH_ALIAS:-$REMOTE_ALIAS}"

DOCROOT="/sites/${DOMAIN}/villes"

ssh -o ConnectTimeout=10 -o BatchMode=yes "$REMOTE_ALIAS" 'exit 0' 2>/dev/null || {
  echo "Connexion SSH impossible — voir PROJET-O2SWITCH.md §5 (autorisation par IP)." >&2
  exit 1
}

# --- Communes attendues, d'après ce qui a été construit en local ---
# Pas de `mapfile` : macOS livre bash 3.2, qui ne l'a pas.
ATTENDUES=()
while IFS= read -r c; do
  [[ -n "$c" ]] && ATTENDUES+=("$c")
done < <(find "$SITE/_villes" -mindepth 1 -maxdepth 1 -type d ! -name assets -exec basename {} \; 2>/dev/null | sort)
[[ ${#ATTENDUES[@]} -gt 0 ]] || { echo "Aucune commune dans $SITE/_villes — lancer build.sh d'abord." >&2; exit 1; }

# --- Sous-domaines déjà déclarés côté serveur ---
DECLARES="$(ssh -o BatchMode=yes "$REMOTE_ALIAS" \
  "uapi --output=json DomainInfo list_domains 2>/dev/null" 2>/dev/null \
  | tr ',' '\n' | grep -o "[a-z0-9*-]*\.${DOMAIN//./\\.}" | sed "s/\.${DOMAIN}\$//" | sort -u)"

manquantes=()
for c in "${ATTENDUES[@]}"; do
  grep -qx "$c" <<<"$DECLARES" || manquantes+=("$c")
done

wildcard_present=0
grep -qx '\*' <<<"$DECLARES" && wildcard_present=1

# Sous-domaines malformés : saisir le nom COMPLET dans l'interface « Sous-domaines »
# de cPanel, qui n'attend qu'un préfixe, produit
#   bordeaux.couvreur-gironde-33.fr.movi6707.odns.fr
# Le vhost existe, ne sert rien, et fait échouer le certificat sur une erreur CAA.
MALFORMES="$(ssh -o BatchMode=yes "$REMOTE_ALIAS" \
  "uapi --output=json DomainInfo list_domains 2>/dev/null" 2>/dev/null \
  | tr ',' '\n' | grep -oE "[a-z0-9.-]*${DOMAIN//./\\.}\.[a-z0-9.-]+" | sort -u || true)"

echo ""
echo "═══ $REL — $DOMAIN"
echo "  document root commun : ${DOCROOT}"
echo "  communes construites : ${#ATTENDUES[@]}"
echo "  déjà déclarées       : $(( ${#ATTENDUES[@]} - ${#manquantes[@]} ))"
echo "  manquantes           : ${#manquantes[@]}"
[[ $wildcard_present -eq 1 ]] && echo "  ${jaune}vhost wildcard « * » encore présent${raz}"

if [[ -n "$MALFORMES" ]]; then
  echo ""
  echo "  ${rouge}Sous-domaine(s) MALFORMÉ(S) — à supprimer dans cPanel :${raz}"
  while IFS= read -r h; do
    [[ -n "$h" ]] || continue
    echo "    ${rouge}${h}${raz}"
    echo "      ${gris}ssh o2 \"uapi SubDomain delsubdomain domain='${h}'\"${raz}"
  done <<<"$MALFORMES"
  echo "  ${gris}Cause : nom complet saisi dans un champ qui n'attend qu'un préfixe.${raz}"
  echo "  ${gris}Ces vhosts ne servent rien et font échouer l'émission du certificat.${raz}"
fi
echo ""

case "$ACTION" in
  status)
    if [[ ${#manquantes[@]} -gt 0 ]]; then
      echo "  Premières manquantes : ${manquantes[*]:0:8} …"
      echo ""
      echo "  Pour les créer :  $0 $REL --create"
    else
      echo "  ${vert}Tous les sous-domaines sont déclarés.${raz}"
      [[ $wildcard_present -eq 1 ]] && \
        echo "  Le wildcard peut être retiré :  $0 $REL --remove-wildcard"
    fi
    ;;

  --liste)
    # Communes triées par population décroissante : le quota étant de 50 par
    # fenêtre de 168 h, autant couvrir d'abord les villes qui pèsent.
    N="${3:-50}"
    node -e '
      const fs=require("fs"), path=require("path");
      const [site, domain, n, dep] = process.argv.slice(1);
      const communes = JSON.parse(fs.readFileSync(
        path.join(process.env.HOME,"Desktop/Coding/Sites-O2Switch/couvreur/data/communes.json"),"utf8"));
      // Filtre par département OBLIGATOIRE : plusieurs communes de France
      // portent le même nom (trois Merignac), et sans ce filtre on recupere la
      // population de la mauvaise, celle du village de 500 habitants.
      // Pas d apostrophe dans ce bloc : il est dans une chaine shell simple.
      const norm = s => String(s).replace(/^0+/,"");
      const pop = new Map();
      for (const c of communes) {
        if (norm(c.dep_code) !== norm(dep)) continue;
        const slug = String(c.nom_sans_accent||"").normalize("NFD").replace(/[̀-ͯ]/g,"")
          .toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
        if (!pop.has(slug)) pop.set(slug, parseInt(c.population,10)||0);
      }
      const dirs = fs.readdirSync(path.join(site,"_villes"),{withFileTypes:true})
        .filter(d=>d.isDirectory() && d.name!=="assets").map(d=>d.name);
      dirs.sort((a,b)=>(pop.get(b)||0)-(pop.get(a)||0) || a.localeCompare(b));
      dirs.slice(0, parseInt(n,10)).forEach((s,i)=>
        console.log(`  ${String(i+1).padStart(3)}. ${s}.${domain}`));
    ' "$SITE" "$DOMAIN" "$N" "${DEP:-}"
    echo ""
    echo "  ($N premières sur ${#ATTENDUES[@]}, par population décroissante)"
    ;;

  --create)
    [[ ${#manquantes[@]} -gt 0 ]] || { echo "  Rien à créer."; exit 0; }
    echo "  Création de ${#manquantes[@]} sous-domaine(s)…"
    echo ""
    ok=0; ko=0
    for c in "${manquantes[@]}"; do
      res="$(ssh -o BatchMode=yes "$REMOTE_ALIAS" \
        "uapi --output=json SubDomain addsubdomain domain='${c}' rootdomain='${DOMAIN}' dir='${DOCROOT}' 2>&1" 2>/dev/null)"
      if grep -q '"status":1\|status: 1' <<<"$res"; then
        ok=$((ok+1)); printf '  %-38s %s\n' "${c}.${DOMAIN}" "${vert}créé${raz}"
      else
        ko=$((ko+1)); printf '  %-38s %s\n' "${c}.${DOMAIN}" "${rouge}échec${raz}"
        printf '  %-38s %s\n' "" "${gris}$(head -c 160 <<<"$res" | tr '\n' ' ')${raz}"
      fi
    done
    echo ""
    echo "  Créés : $ok    Échecs : $ko"
    echo ""
    echo "  Étape suivante : émettre les certificats — 50 max par 168 h glissantes."
    echo "  Voir PROJET-O2SWITCH.md §6."
    ;;

  --remove-wildcard)
    [[ $wildcard_present -eq 1 ]] || { echo "  Pas de vhost wildcard à retirer."; exit 0; }
    if [[ ${#manquantes[@]} -gt 0 ]]; then
      echo "  ${rouge}Refus : ${#manquantes[@]} commune(s) n'ont pas encore leur vhost.${raz}"
      echo "  Retirer le wildcard maintenant les rendrait injoignables."
      exit 1
    fi
    echo "  Suppression du vhost « *.${DOMAIN} »…"
    ssh -o BatchMode=yes "$REMOTE_ALIAS" \
      "uapi SubDomain delsubdomain domain='*.${DOMAIN}' 2>&1" 2>/dev/null | tail -3
    ;;

  *)
    echo "Action inconnue : $ACTION" >&2; exit 1 ;;
esac
echo ""
