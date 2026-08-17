#!/usr/bin/env bash
#
# Mise en ligne d'UNE commune, étape par étape, sans jamais forcer.
#
#   ./golive.sh couvreur/gironde bordeaux            état des 4 étapes
#   ./golive.sh couvreur/gironde bordeaux --deploy   envoie cette commune
#   ./golive.sh couvreur/gironde bordeaux --https    active sa redirection
#
# Chaque étape REFUSE de s'exécuter si la précédente n'est pas acquise.
# En particulier --https vérifie le certificat en direct : impossible de
# rediriger une commune vers HTTPS si son certificat n'est pas reconnu.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Défauts, surchargeables par .site : les métiers sont répartis sur plusieurs
# comptes cPanel (« Lunes »). Voir PROJET-O2SWITCH.md §2.
REMOTE_ALIAS="o2"; REMOTE_USER="movi6707"

rouge=$'\033[31m'; vert=$'\033[32m'; jaune=$'\033[33m'; gris=$'\033[90m'; raz=$'\033[0m'
[[ -t 1 ]] || { rouge=''; vert=''; jaune=''; gris=''; raz=''; }

REL="${1:-}"; COMMUNE="${2:-}"; ACTION="${3:-status}"
[[ -n "$REL" && -n "$COMMUNE" ]] || {
  echo "usage: $0 <metier/departement> <commune> [--deploy|--https|--etapes]" >&2; exit 1; }
REL="${REL%/}"; SITE="$ROOT/$REL"

[[ -f "$SITE/.site" ]] || { echo "Fichier .site manquant dans $SITE" >&2; exit 1; }
DOMAIN=""; SSH_ALIAS=""; CPANEL_USER=""
# shellcheck disable=SC1090
source "$SITE/.site"
[[ -n "$DOMAIN" ]] || { echo "DOMAIN non défini dans $SITE/.site" >&2; exit 1; }
REMOTE_ALIAS="${SSH_ALIAS:-$REMOTE_ALIAS}"
REMOTE_USER="${CPANEL_USER:-$REMOTE_USER}"

SRC="$SITE/_villes/$COMMUNE"
HOTE="${COMMUNE}.${DOMAIN}"
DIST="/home/${REMOTE_USER}/sites/${DOMAIN}/villes"
ACTIVES="$SITE/.https-actives"

[[ -d "$SRC" ]] || { echo "Commune inconnue en local : $SRC" >&2; exit 1; }

# --etapes est une simple fiche de procédure : elle doit rester consultable même
# quand le SSH est coupé (IP publique changée), justement pour savoir quoi faire.
if [[ "$ACTION" == "--etapes" ]]; then
  cat <<FICHE

═══ Mettre en ligne ${HOTE}

  0. PRÉALABLES — si quelque chose semble injoignable, c'est presque toujours l'un des deux
     Autoriser l'IP : cPanel → Autorisation SSH
       curl -s https://ifconfig.me; echo
       ssh o2 'echo OK'
     Vider le cache DNS : macOS mémorise l'absence d'un sous-domaine interrogé
     avant sa création — le site paraît introuvable alors qu'il est en ligne.
       sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder

  1. DÉPLOYER le contenu
     ./golive.sh $REL $COMMUNE --deploy

  2. DÉCLARER le sous-domaine — cPanel → Domaines → Créer un domaine
     Domaine ................. ${COMMUNE}
     Domaine racine .......... ${DOMAIN}
     Répertoire racine ....... sites/${DOMAIN}/villes
     Partager le répertoire .. DÉCOCHÉ
     ${gris}Le champ Domaine ne prend que le nom de la ville, pas l'adresse
     complète : cPanel ajoute le domaine racine. Résultat attendu ${HOTE}.
     Y saisir l'adresse complète donnerait ${HOTE}.${REMOTE_USER}.odns.fr,
     et le certificat échouerait sur une erreur CAA.
     La racine est « villes », sans /${COMMUNE} : le routeur lit le nom
     d'hôte et sert le bon dossier. C'est ce qui mutualise les assets.${raz}
     Sans ambiguïté possible :
     ssh o2 "uapi SubDomain addsubdomain domain='${COMMUNE}' rootdomain='${DOMAIN}' dir='/sites/${DOMAIN}/villes'"

  3. ÉMETTRE le certificat — cPanel → SSL/TLS → Let's Encrypt™
     Domaine ................. ${HOTE}
     Validation .............. http-01
     Wildcard ................ NON
     ${gris}Plafond : 50 certificats par domaine racine sur 168 h GLISSANTES.
     Atteint, le refus indique l'heure exacte de déblocage — s'y fier.
     Seules les émissions réussies comptent : un échec ne coûte rien, donc
     inutile de simuler. Vérifier la propagation DNS avant d'émettre.${raz}

  4. ACTIVER la redirection HTTP → HTTPS
     ./golive.sh $REL $COMMUNE --https
     ./build.sh $REL && ./deploy.sh $REL _villes
     ${gris}Refusé tant que le certificat n'est pas reconnu.${raz}

  À tout moment, l'état des 4 étapes :
     ./golive.sh $REL $COMMUNE

FICHE
  exit 0
fi

ssh -o ConnectTimeout=10 -o BatchMode=yes "$REMOTE_ALIAS" 'exit 0' 2>/dev/null || {
  echo "Connexion SSH impossible — voir PROJET-O2SWITCH.md §5." >&2; exit 1; }

# ─── Constats ────────────────────────────────────────────────────────────────

deploye=0
ssh -o BatchMode=yes "$REMOTE_ALIAS" "[ -f '${DIST}/${COMMUNE}/index.html' ]" 2>/dev/null && deploye=1

declare_=0
ssh -o BatchMode=yes "$REMOTE_ALIAS" \
  "uapi --output=json DomainInfo list_domains 2>/dev/null" 2>/dev/null \
  | grep -q "\"${HOTE}\"" && declare_=1

# Certificat : la date ne suffit pas, cPanel pose un auto-signé d'un an sur
# chaque vhost neuf. On exige une chaîne de confiance valide.
#
# On résout le nom avec dig et on se connecte à l'IP : le résolveur système de
# macOS garde en cache l'ABSENCE d'un sous-domaine créé il y a peu, et
# getaddrinfo échoue alors que le DNS répond parfaitement. Sans ce contournement
# le script conclurait « pas de certificat » sur un certificat valide.
cert_ok=0; cert_info="pas de certificat"
IP_HOTE="$(dig +short A "$HOTE" @8.8.8.8 2>/dev/null | grep -E '^[0-9.]+$' | head -1)"
[[ -n "$IP_HOTE" ]] || IP_HOTE="$(dig +short A "$HOTE" 2>/dev/null | grep -E '^[0-9.]+$' | head -1)"
if [[ -z "$IP_HOTE" ]]; then
  cert_info="nom non résolu — le sous-domaine est-il déclaré ?"
  brut=""
else
  brut="$(echo | openssl s_client -connect "${IP_HOTE}:443" -servername "$HOTE" 2>&1)"
fi
if grep -q 'BEGIN CERTIFICATE' <<<"$brut"; then
  code="$(grep -o 'Verify return code: [0-9]*' <<<"$brut" | tail -1 | grep -o '[0-9]*$')"
  emetteur="$(sed -n '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/p' <<<"$brut" \
              | openssl x509 -noout -issuer 2>/dev/null | sed 's/.*CN *= *//')"
  if [[ "${code:-99}" == "0" ]]; then cert_ok=1; cert_info="valide — émis par ${emetteur}"
  else cert_info="NON RECONNU (code ${code}) — émetteur ${emetteur}"; fi
fi

https_actif=0
[[ -f "$ACTIVES" ]] && grep -qx "$COMMUNE" "$ACTIVES" && https_actif=1

# Propagation DNS — c'est elle qui fait échouer l'émission avec NXDOMAIN.
# Let's Encrypt interroge depuis plusieurs points du globe : il suffit qu'un
# résolveur soit en retard pour que la validation tombe. Vérifier ici coûte
# deux secondes et remplace avantageusement la simulation.
prop_ok=0; prop_tot=0
for r in 8.8.8.8 1.1.1.1 9.9.9.9 208.67.222.222; do
  prop_tot=$((prop_tot+1))
  if dig +short +time=2 +tries=1 A "$HOTE" "@$r" 2>/dev/null | grep -qE '^[0-9.]+$'; then
    prop_ok=$((prop_ok+1))
  fi
done

etat() { [[ "$1" -eq 1 ]] && echo "${vert}fait${raz}" || echo "${jaune}à faire${raz}"; }

echo ""
echo "═══ $HOTE"
printf '  1. contenu déployé      %s\n' "$(etat $deploye)"
printf '  2. sous-domaine déclaré %s\n' "$(etat $declare_)"
printf '  3. certificat           %s  %s\n' "$(etat $cert_ok)" "${gris}${cert_info}${raz}"
printf '  4. redirection HTTPS    %s\n' "$(etat $https_actif)"
echo ""

# ─── Actions ─────────────────────────────────────────────────────────────────

case "$ACTION" in
  status)
    if   [[ $deploye  -eq 0 ]]; then echo "  Suivant :  $0 $REL $COMMUNE --deploy"
    elif [[ $declare_ -eq 0 ]]; then
      echo "  Suivant : déclarer le sous-domaine dans cPanel → Domaines → Créer un domaine"
      echo "            domaine  : ${COMMUNE}   (cPanel ajoute ${DOMAIN})"
      echo "            racine   : sites/${DOMAIN}/villes"
      echo "            « Partager le répertoire racine » DÉCOCHÉ"
    elif [[ $cert_ok  -eq 0 ]]; then
      if [[ $prop_ok -lt $prop_tot ]]; then
        echo "  ${jaune}Attendre : DNS propagé sur ${prop_ok}/${prop_tot} résolveurs.${raz}"
        echo "  Émettre maintenant échouerait sur « NXDOMAIN looking up A »."
        echo "  Relancer cette commande dans quelques minutes."
      else
        echo "  ${vert}DNS propagé (${prop_ok}/${prop_tot}) — prêt à émettre.${raz}"
        echo "  cPanel → SSL/TLS → Let's Encrypt → ${HOTE}"
        echo "            validation http-01, sans wildcard"
        echo "  ${gris}Simulation inutile : un échec ne consomme rien. Plafond de 50 par"
        echo "  domaine racine sur 168 h glissantes.${raz}"
      fi
    elif [[ $https_actif -eq 0 ]]; then echo "  Suivant :  $0 $REL $COMMUNE --https"
    else echo "  ${vert}Commune entièrement en ligne.${raz}"; fi
    ;;

  --deploy)
    # Socle commun (assets, routeur, 404) d'abord : sans lui la commune s'affiche nue.
    echo "  Envoi du socle commun puis de la commune…"
    rsync -rlz --omit-dir-times -p \
      --exclude '.site' --exclude '.DS_Store' \
      --include 'assets/***' --include '.htaccess' --include '404.html' \
      --exclude '*' \
      "$SITE/_villes/" "${REMOTE_ALIAS}:${DIST}/" || { echo "  ${rouge}échec socle${raz}"; exit 1; }
    rsync -rlz --omit-dir-times -p --delete \
      --exclude '.DS_Store' \
      "$SRC/" "${REMOTE_ALIAS}:${DIST}/${COMMUNE}/" || { echo "  ${rouge}échec commune${raz}"; exit 1; }
    echo "  ${vert}déployé${raz} — relancer sans option pour l'étape suivante"
    ;;

  --https)
    if [[ $cert_ok -eq 0 ]]; then
      echo "  ${rouge}Refus : le certificat de ${HOTE} n'est pas reconnu.${raz}"
      echo "  ${gris}${cert_info}${raz}"
      echo ""
      # Trois causes distinctes, trois remèdes : ne pas les confondre.
      if [[ "$cert_info" == *"non résolu"* ]]; then
        echo "  Le nom ne résout pas. Deux possibilités :"
        echo "    · le sous-domaine n'est pas déclaré dans cPanel (étape 2) ;"
        echo "    · macOS garde en cache son absence, interrogée avant sa création :"
        echo "        ${gris}sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder${raz}"
      elif [[ "$cert_info" == *"code 18"* || "$cert_info" == *"code 19"* ]]; then
        echo "  Le serveur présente encore le certificat AUTO-SIGNÉ hérité du vhost"
        echo "  wildcard. Si cPanel indique pourtant le certificat comme installé,"
        echo "  c'est qu'Apache n'a pas encore rechargé : patienter quelques minutes"
        echo "  puis relancer. Vérifier ce qui est réellement installé :"
        echo "    ${gris}ssh o2 \"uapi SSL installed_hosts\" | grep ${COMMUNE}${raz}"
      else
        echo "  Émettre le certificat — cPanel → SSL/TLS → Let's Encrypt :"
        echo "    ${gris}${HOTE}, validation http-01, sans wildcard${raz}"
      fi
      echo ""
      echo "  Activer la redirection maintenant afficherait un avertissement de"
      echo "  sécurité en pleine page à chaque visiteur."
      exit 1
    fi
    if [[ $https_actif -eq 1 ]]; then echo "  Déjà active."; exit 0; fi
    [[ -f "$ACTIVES" ]] || printf '# Communes dont le certificat est vérifié.\n# Géré par golive.sh — ne pas éditer à la main.\n' > "$ACTIVES"
    echo "$COMMUNE" >> "$ACTIVES"
    echo "  ${vert}${COMMUNE} ajoutée à .https-actives${raz}"
    echo ""
    echo "  Reste à régénérer et publier le routeur :"
    echo "    ./build.sh $REL && ./deploy.sh $REL _villes"
    ;;

  *) echo "Action inconnue : $ACTION" >&2; exit 1 ;;
esac
echo ""
