# Site départemental (apex) — généré par build.sh, NE PAS ÉDITER DANS _root/
# Le modèle se trouve dans _shared/htaccess-root.tpl
#
# Sans ce fichier le site départemental n'a AUCUNE redirection : il reste
# accessible en http ET en https, et Google indexe les deux.

RewriteEngine On
Options -Indexes

# 1 — une seule URL canonique : https, sans www.
#
#     Les deux règles sont séparées pour n'avoir qu'UNE redirection dans le cas
#     courant. Fusionnées, http://www→https://non-www ferait deux sauts.
#     L'exclusion .well-known laisse passer la validation HTTP-01 de Let's
#     Encrypt, qui doit rester joignable en clair — y compris sur www, car le
#     certificat de l'apex couvre les deux noms.
#
#     À DÉCOMMENTER UNE FOIS LE CERTIFICAT DE L'APEX EN PLACE.

# 1a — www -> non-www (en conservant le schéma, pour ne pas doubler le saut)
__HTTPS__RewriteCond %{REQUEST_URI} !^/\.well-known/
__HTTPS__RewriteCond %{HTTP_HOST} ^www\.(.+)$ [NC]
__HTTPS__RewriteCond %{HTTPS} =on
__HTTPS__RewriteRule ^ https://%1%{REQUEST_URI} [R=301,L]

# 1b — http -> https (sur le nom déjà canonique)
__HTTPS__RewriteCond %{REQUEST_URI} !^/\.well-known/
__HTTPS__RewriteCond %{HTTPS} !=on
__HTTPS__RewriteCond %{HTTP_HOST} ^(?:www\.)?(.+)$ [NC]
__HTTPS__RewriteRule ^ https://%1%{REQUEST_URI} [R=301,L]

# 2 — URLs propres : /mentions-legales -> /mentions-legales.html
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
