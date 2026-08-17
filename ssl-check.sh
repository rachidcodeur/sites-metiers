#!/usr/bin/env bash
#
# État des certificats et des redirections, pour tous les domaines du dépôt.
#
#   ./ssl-check.sh                    tous les domaines trouvés
#   ./ssl-check.sh couvreur/gironde   un seul
#
# Le renouvellement Let's Encrypt étant manuel, ce script est le tableau de bord :
# il dit quels certificats expirent bientôt et si la redirection HTTPS est active.
# Aucun accès SSH requis — tout est vu depuis l'extérieur, comme un visiteur.
#
# Codes de sortie : 0 tout va bien · 1 au moins un point à traiter

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SEUIL_JOURS=30                      # en dessous, on prévient
SEUIL_SEC=$((SEUIL_JOURS * 86400))

rouge=$'\033[31m'; vert=$'\033[32m'; jaune=$'\033[33m'; gris=$'\033[90m'; raz=$'\033[0m'
[[ -t 1 ]] || { rouge=''; vert=''; jaune=''; gris=''; raz=''; }

souci=0

etat_certificat() {
  local hote="$1" brut pem verdict

  # Une seule poignée de main : on en tire le certificat ET le résultat de la
  # vérification de chaîne. Vérifier la seule date ne suffit pas — cPanel installe
  # un certificat AUTO-SIGNÉ d'un an sur chaque vhost neuf. Il a une date de fin
  # parfaitement valide et pourtant aucun navigateur ne l'accepte.
  # Résolution via dig puis connexion à l'IP : le résolveur système de macOS
  # garde en cache l'absence d'un sous-domaine récemment créé, et ferait
  # conclure à tort « pas de certificat ».
  local ip
  ip="$(dig +short A "$hote" @8.8.8.8 2>/dev/null | grep -E '^[0-9.]+$' | head -1)"
  [[ -n "$ip" ]] || ip="$(dig +short A "$hote" 2>/dev/null | grep -E '^[0-9.]+$' | head -1)"
  if [[ -z "$ip" ]]; then
    printf '  %-46s %s\n' "$hote" "${rouge}nom non résolu${raz}"
    souci=1
    return
  fi

  brut="$(echo | openssl s_client -connect "$ip:443" -servername "$hote" 2>&1)"
  pem="$(sed -n '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/p' <<<"$brut" | head -100)"

  if [[ -z "$pem" ]]; then
    printf '  %-46s %s\n' "$hote" "${rouge}pas de certificat joignable${raz}"
    souci=1
    return
  fi

  local sujet emetteur expire confiance
  sujet="$(openssl x509 -noout -subject <<<"$pem" 2>/dev/null | sed 's/.*CN *= *//')"
  emetteur="$(openssl x509 -noout -issuer  <<<"$pem" 2>/dev/null | sed 's/.*CN *= *//')"
  expire="$(openssl x509 -noout -enddate  <<<"$pem" 2>/dev/null | sed 's/^notAfter=//')"
  confiance="$(grep -o 'Verify return code: [0-9]*' <<<"$brut" | tail -1 | grep -o '[0-9]*$')"

  # openssl -checkend évite tout parsing de date, illisible entre macOS et Linux
  if [[ "${confiance:-99}" != "0" ]]; then
    if [[ "$sujet" == "$emetteur" ]]; then
      verdict="${rouge}AUTO-SIGNÉ — certificat de remplacement cPanel, à remplacer${raz}"
    else
      verdict="${rouge}NON RECONNU (code $confiance) — les navigateurs le refuseront${raz}"
    fi
    souci=1
  elif ! openssl x509 -checkend 0 -noout <<<"$pem" >/dev/null 2>&1; then
    verdict="${rouge}EXPIRÉ${raz}"; souci=1
  elif ! openssl x509 -checkend "$SEUIL_SEC" -noout <<<"$pem" >/dev/null 2>&1; then
    verdict="${jaune}expire dans moins de ${SEUIL_JOURS} j — À RENOUVELER${raz}"; souci=1
  else
    verdict="${vert}valide${raz}"
  fi

  printf '  %-46s %s\n' "$hote" "$verdict"
  printf '  %-46s %s\n' "" "${gris}CN=${sujet} · émis par ${emetteur} · jusqu'au ${expire}${raz}"
}

# Vérifie qu'une URL en clair part bien en 301 vers la même URL en https
etat_redirection() {
  local url="$1" code cible
  code="$(curl -s -o /dev/null -m 12 -w '%{http_code}' "$url" 2>/dev/null)"
  cible="$(curl -s -o /dev/null -m 12 -w '%{redirect_url}' "$url" 2>/dev/null)"
  local attendu="https://${url#http://}"

  if [[ "$code" == "301" && "$cible" == "$attendu" ]]; then
    printf '  %-46s %s\n' "$url" "${vert}301 -> $cible${raz}"
  elif [[ "$code" == "301" ]]; then
    printf '  %-46s %s\n' "$url" "${jaune}301 mais vers $cible (attendu $attendu)${raz}"
    souci=1
  elif [[ -z "$code" || "$code" == "000" ]]; then
    printf '  %-46s %s\n' "$url" "${gris}injoignable${raz}"
  else
    printf '  %-46s %s\n' "$url" "${rouge}$code — le HTTP répond, il sera indexé${raz}"
    souci=1
  fi
}

# ─── Domaines à examiner ─────────────────────────────────────────────────────
if [[ $# -gt 0 ]]; then
  fichiers=("$ROOT/${1%/}/.site")
else
  fichiers=()
  while IFS= read -r f; do fichiers+=("$f"); done \
    < <(find "$ROOT" -mindepth 3 -maxdepth 3 -name .site 2>/dev/null | sort)
fi

[[ ${#fichiers[@]} -gt 0 ]] || { echo "Aucun fichier .site trouvé." >&2; exit 1; }

for f in "${fichiers[@]}"; do
  [[ -f "$f" ]] || { echo "Introuvable : $f" >&2; souci=1; continue; }

  DOMAIN=""; DEP_NOM=""
  # shellcheck disable=SC1090
  source "$f"
  [[ -n "$DOMAIN" ]] || { echo "DOMAIN absent de $f" >&2; souci=1; continue; }

  site_dir="$(dirname "$f")"

  # Une commune réellement déployée, pour tester le vhost wildcard
  commune="$(find "$site_dir/_villes" -mindepth 1 -maxdepth 1 -type d ! -name assets \
             -exec basename {} \; 2>/dev/null | sort | head -1)"

  echo ""
  echo "═══ ${DEP_NOM:-?} — $DOMAIN"
  echo ""
  echo " Certificats"
  etat_certificat "$DOMAIN"
  etat_certificat "www.$DOMAIN"
  [[ -n "$commune" ]] && etat_certificat "$commune.$DOMAIN"

  echo ""
  echo " Redirections HTTP -> HTTPS"
  etat_redirection "http://$DOMAIN/"
  [[ -n "$commune" ]] && etat_redirection "http://$commune.$DOMAIN/"
done

echo ""
if [[ $souci -eq 0 ]]; then
  echo "${vert}Tout est en ordre.${raz}"
else
  echo "${jaune}Des points sont à traiter — voir PROJET-O2SWITCH.md §6.${raz}"
fi
exit $souci
