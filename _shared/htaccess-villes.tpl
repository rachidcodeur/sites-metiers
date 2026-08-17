# Routeur wildcard — généré par build.sh, NE PAS ÉDITER DANS _villes/
# Le modèle se trouve dans _shared/htaccess-villes.tpl

RewriteEngine On
Options -Indexes

# 0 — HTTPS. DOIT rester la PREMIÈRE règle.
#
#     Placée après le routage (règles 5 et 6), elle s'exécuterait sur la passe
#     interne suivante et redirigerait vers le chemin RÉÉCRIT : une requête
#     http://bordeaux.…/toiture partirait en 301 vers
#     https://bordeaux.…/bordeaux/toiture.html — le chemin interne fuiterait
#     dans l'URL publique, et c'est cette URL que Google indexerait.
#
#     %{REQUEST_URI} conserve l'URI d'origine ; la query string est réattachée
#     automatiquement par mod_rewrite.
#     L'exclusion .well-known laisse passer la validation HTTP-01 de Let's
#     Encrypt, qui doit rester joignable en clair.
#
#     À DÉCOMMENTER UNE FOIS LE CERTIFICAT WILDCARD EN PLACE — pas avant,
#     sinon les visiteurs tombent sur un avertissement de certificat.
#     La liste des hôtes est générée depuis .https-actives : seules les communes
#     dont le certificat est VÉRIFIÉ y figurent. Une commune absente continue
#     d'être servie en clair avec X-Robots-Tag noindex — jamais de redirection
#     vers un vhost sans certificat, donc jamais d'avertissement de sécurité.
__HTTPS__RewriteCond %{HTTPS} !=on
__HTTPS__RewriteCond %{REQUEST_URI} !^/\.well-known/
__HTTPS__RewriteCond %{HTTP_HOST} ^(__HTTPS_HOSTS__)\.__DOMAIN_REGEX__$ [NC]
__HTTPS__RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]

# 1 — capturer le sous-domaine (commune)
RewriteCond %{ENV:REDIRECT_STATUS} ^$
RewriteCond %{HTTP_HOST} ^([a-z0-9-]+)\.__DOMAIN_REGEX__$ [NC]
RewriteRule ^ - [E=VILLE:%1]

# 2 — laisser passer la validation Let's Encrypt
RewriteRule ^\.well-known/ - [L]

# 3 — assets mutualisés, servis depuis la racine du docroot
RewriteCond %{ENV:VILLE} !^$
RewriteRule ^(assets|static)/ - [L]

# 4 — commune inconnue -> 404 propre
RewriteCond %{ENV:VILLE} !^$
RewriteCond %{DOCUMENT_ROOT}/%{ENV:VILLE} !-d
RewriteRule ^ - [R=404,L]

# 5 — routage vers le dossier de la commune
RewriteCond %{ENV:VILLE} !^$
RewriteRule ^(.*)$ /%{ENV:VILLE}/$1 [L]

# 6 — URLs propres : /toiture -> /toiture.html
RewriteCond %{REQUEST_FILENAME} !-d
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME}\.html -f
RewriteRule ^(.*)$ $1.html [L]

ErrorDocument 404 /404.html

<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/html              "access plus 2 hours"
  ExpiresByType text/css               "access plus 1 year"
  ExpiresByType application/javascript "access plus 1 year"
  ExpiresByType image/webp             "access plus 1 year"
  ExpiresByType image/avif             "access plus 1 year"
  ExpiresByType image/svg+xml          "access plus 1 year"
  ExpiresByType font/woff2             "access plus 1 year"
</IfModule>

<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css text/plain text/xml \
    application/javascript application/json image/svg+xml
</IfModule>

<IfModule mod_headers.c>
  # Tant que le certificat n'est pas en place, les réponses EN CLAIR sont
  # explicitement non indexables. C'est ce qui empêche Google d'indexer une
  # version http:// qui ferait ensuite doublon avec l'https.
  #
  # La condition porte sur le protocole, pas sur une date : la version HTTPS
  # reste pleinement indexable, et cette règle devient sans objet dès que la
  # redirection 301 est activée (le HTTP ne sert alors plus aucune page).
  # Rien à retirer plus tard, donc rien à oublier.
  Header always set X-Robots-Tag "noindex, nofollow" "expr=%{HTTPS} != 'on'"

  Header set X-Content-Type-Options "nosniff"
  Header set Referrer-Policy "strict-origin-when-cross-origin"
</IfModule>
