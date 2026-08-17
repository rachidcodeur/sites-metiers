
Récupérer mon IP :

curl -s https://ifconfig.me; echo



# Réseau de sites locaux sur o2switch — documentation de projet

> Document de reprise. Il contient le contexte, les décisions d'architecture et
> leurs raisons, l'état d'avancement, les scripts et les procédures.
> À lire en entier avant toute modification : plusieurs choix qui semblent
> perfectibles sont en réalité contraints par l'hébergement mutualisé.

---

## 1. Objectif

Publier un réseau de sites statiques locaux sur un modèle :

```
{commune}.{metier}-{departement}-{code}.fr
```

Exemple en cours : `bordeaux.couvreur-gironde-33.fr`, `merignac.couvreur-gironde-33.fr`…

Volumétrie cible : **~250 communes par département × 95 départements × 6 métiers**.
Le générateur plafonne les communes par population (249 sites pour la Gironde).

Migration depuis OVH (VPS, Nginx, certbot) vers o2switch (mutualisé, cPanel, Apache).

---

## 2. Contraintes o2switch — à connaître avant de proposer quoi que ce soit

Hébergement **mutualisé cPanel**, pas un VPS. Donc :

- Pas de root, pas de Nginx, pas de systemd. Apache, configuration par `.htaccess` uniquement.
- SSH disponible, mais **filtré par IP** : chaque machine qui déploie doit être
  déclarée dans cPanel → Autorisation SSH. Une CI cloud (GitHub Actions) ne
  peut donc pas déployer — IP changeantes.
- Ressources offre Grow : 8 threads CPU, 16 Go RAM, 16 MB/s I/O, 4 « Lunes »
  (comptes cPanel indépendants).
- **Seuil critique : au-delà de 100 000 fichiers sur un compte, o2switch cesse
  d'archiver les sauvegardes.** C'est la contrainte dimensionnante du projet,
  bien plus que le CPU ou le disque.
- Nombre de domaines et sous-domaines : illimité contractuellement.

### SSL — le point qui a déterminé toute l'architecture

Trois faits, dans cet ordre :

1. Let's Encrypt plafonne à **50 certificats par domaine racine sur 168 heures
   glissantes**. Seules les émissions réussies comptent ; les renouvellements en
   sont exemptés. Vérifié en production le 2026-08-10 (voir plus bas).
2. Un certificat wildcard exige la **validation DNS-01**, donc que le domaine
   utilise les serveurs DNS d'o2switch (`ns1/ns2.o2switch.net`). Incompatible
   avec Cloudflare en proxy.
3. **Sur cPanel, un certificat wildcard n'est pas automatiquement appliqué aux
   sous-domaines créés manuellement.** Il faut l'installer sur chaque vhost, et
   ces installations manuelles **ne se mettent pas à jour au renouvellement**.

Conséquences chiffrées pour 249 communes sur un département :

| Approche | Vhosts | Certificats | Délai | Renouvellement |
|---|---|---|---|---|
| **1 vhost par commune + 1 cert par commune** | **250** | **250** | **5 semaines** (quota) | 250 opérations / 90 j |
| 1 vhost par commune + wildcard installé partout | 250 | 1 | 1 jour | casse à 90 jours |
| 1 vhost wildcard + routage `.htaccess` | 2 | 1 | 1 jour | 1 opération / 90 j |

**Choix retenu : la première ligne** — un sous-domaine déclaré et un certificat
par commune. Décision prise en connaissance du coût (2026-08-09) : la
troisième ligne passe mieux à l'échelle, mais l'exploitation doit rester
explicite et maîtrisée, chaque sous-domaine étant une entrée réelle dans cPanel.

Deux conséquences à assumer :

- **5 semaines pour couvrir un département.** 249 communes à 50 certificats par
  fenêtre de 168 h, soit 5 vagues. Le plafond est bien réel — constaté en
  production le 2026-08-10 :

  ```
  429 rateLimited : too many certificates (50) already issued for
  "couvreur-gironde-33.fr" in the last 168h0m0s,
  retry after 2026-08-10 19:57:18 UTC
  ```

  La fenêtre est **glissante**, pas calendaire : le quota se libère au fur et à
  mesure, 168 h après chaque émission. Le message indique toujours l'heure
  exacte de déblocage — s'y fier plutôt que compter soi-même.
- **Un renouvellement par commune tous les 90 jours**, le renouvellement étant
  manuel. `ssl-check.sh` sert de tableau de bord ; à surveiller quand le nombre
  de départements augmentera.

> **Ce qui consomme quoi.** Le plafond ne compte que les émissions **réussies**.
> Une validation qui échoue ne coûte rien (mais une limite distincte borne les
> échecs répétés sur un même nom d'hôte). **Réinstaller** un certificat déjà
> présent ne contacte pas Let's Encrypt du tout : c'est gratuit et sans limite.

---

## 3. Architecture retenue

### Côté serveur — un vhost déclaré par commune

| Entrée cPanel | Document root | Rôle |
|---|---|---|
| `couvreur-gironde-33.fr` | `/home/movi6707/sites/couvreur-gironde-33.fr/_root` | site départemental |
| `bordeaux.couvreur-gironde-33.fr` | `/home/movi6707/sites/couvreur-gironde-33.fr/villes` | commune |
| `merignac.couvreur-gironde-33.fr` | *(même docroot)* | commune |
| … 249 au total | | |

**Pourquoi un vhost par commune** — un certificat ne peut être installé que sur
un vhost déclaré. 249 certificats distincts imposent donc 249 vhosts. C'est aussi
ce qui rend chaque sous-domaine visible et gérable individuellement dans cPanel.

**Pourquoi un document root commun** — les assets sont mutualisés à la racine de
`villes/` (§7). Avec un docroot par commune, `/assets/` sortirait de la racine du
site et il faudrait recopier les 15 fichiers dans chaque commune : ~380 000
fichiers sur 95 départements, près de 4 fois le seuil de sauvegarde d'o2switch.

Le `.htaccess` à la racine de `villes/` lit `HTTP_HOST`, en extrait le nom de
commune et sert le dossier correspondant. Vu de l'extérieur, chaque sous-domaine
est un site autonome avec son propre certificat.

`subdomains.sh` gère ces déclarations (voir §5). Ajouter une commune = créer le
dossier **et** déclarer le sous-domaine.

**Règle absolue : les document roots ne sont jamais dans `public_html`.**
Sinon le contenu est servi à la fois sur le domaine et sur le domaine technique
`movi6707.odns.fr` → duplicate content sur tout le réseau.

### Côté serveur — arborescence

```
/home/movi6707/
├── public_html/                              (domaine technique, non utilisé)
└── sites/
    └── couvreur-gironde-33.fr/
        ├── _root/                            (site départemental)
        └── villes/
            ├── .htaccess                     (le routeur)
            ├── 404.html
            ├── assets/                       (mutualisés — voir §7)
            │   ├── style.css
            │   ├── js/
            │   └── images/
            ├── bordeaux/                     (index.html, sitemap.xml, robots.txt)
            ├── merignac/
            └── …
```

### Côté local

**Rien de spécifique à un métier ne vit à la racine.** La racine ne porte que les
deux scripts et ce document ; tout le reste est soit dans `_shared/` (commun aux
métiers), soit dans `<metier>/`. C'est ce qui permettra d'ajouter peintre,
plombier… sans collision.

```
~/Desktop/Coding/Sites-O2Switch/
├── build.sh                    génère + met en forme
├── deploy.sh                   envoie par rsync
├── ssl-check.sh                état des certificats et des redirections
├── subdomains.sh               déclare un vhost cPanel par commune
├── PROJET-O2SWITCH.md
├── .gitignore
├── _shared/                    commun à TOUS les métiers
│   ├── htaccess-villes.tpl     routeur des sous-domaines communes
│   ├── htaccess-root.tpl       apex : HTTPS + www -> non-www
│   └── 404.html                page d'erreur commune
└── couvreur/                   un dossier par métier
    ├── _generator/             LE générateur du métier (une seule copie)
    │   ├── generate.js             moteur des sites communes
    │   ├── generate-dep.js         moteur du site départemental
    │   ├── index.html              ← template commune  ⎫
    │   ├── style.css               ←                   ⎬ le template,
    │   ├── script.js               ←                   ⎪ propre au métier
    │   ├── data/variables.json     ← 60 slots × 5 var. ⎭
    │   ├── index-dep.html          template départemental (ancien design)
    │   ├── public/images/          les images du template
    │   └── output/                 sortie brute, jamais déployée
    ├── json-communes -> …      symlink (voir §9, point ouvert)
    ├── data -> …               symlink
    └── gironde/                un dossier par département
        ├── .site               DOMAIN / DEP / DEP_NOM
        ├── _root/              rempli par build.sh
        └── _villes/            rempli par build.sh
```

Le template est donc **par métier**, jamais partagé : un nouveau métier apporte
son propre `<metier>/_generator/` avec ses `index.html`, `style.css`,
`script.js`, `data/variables.json` et `public/images/`.

Le générateur est **par métier** (templates différents), partagé entre les 95
départements de ce métier. Il ne doit jamais se trouver dans un dossier déployé :
`communes.json` pèse 11 Mo et n'a rien à faire en ligne.

### Le template des sites communes

Le template en service vient de `sites-villes-ovh/couvreur 2/` — la variante qui
fait foi (son `index.html` était identique au fichier de référence, et elle seule
possède les 13 images). L'ancien template est conservé en
`_generator/index.html.avant-couvreur2`.

| Fichier | Rôle |
|---|---|
| `_generator/index.html` | template de la page commune, placeholders `{{VAR}}` |
| `_generator/data/variables.json` | 60 slots de texte × 5 variantes |
| `_generator/style.css` | feuille de style, mutualisée en `/assets/style.css` |
| `_generator/script.js` | menu, apparitions, FAQ, envoi Supabase |
| `_generator/public/images/` | les 13 images du template |

**Variantes de texte.** Chaque slot de `variables.json` a 5 variantes ; le choix
est `SHA-256(slug-commune + slot)`, donc déterministe et stable d'un build à
l'autre, mais différent d'une commune à l'autre. Les variantes peuvent contenir
des variables en **accolade simple** (`{NOM_A}`, `{DEP_NOM_DE}`) : `replace()`
fait deux passes, `{{VAR}}` puis `{VAR}`.

**Formes de département.** Ne jamais écrire `du {DEP_NOM}` dans une variante :
ça donne « du Gironde ». Le générateur expose les formes déclinées de sa table
`DEP_FORMES` (102 entrées) — `{DEP_NOM_A}` (« en Gironde », « dans l'Ain »),
`{DEP_NOM_DE}` (« de Gironde », « des Hautes-Alpes »), `{DEP_NOM_LE}`.
`{DEP_NOM}` nu ne convient qu'en apposition : « (Gironde 33) ».

**Pas de maillage inter-communes.** Le template n'a pas de section « communes
proches » : les 249 sites ne se lient pas entre eux. `nearestCommunes()` et
`renderCommunesProches()` restent dans le générateur si le choix est revu.

### Le fichier `.site`

Fait le lien entre le chemin local et le domaine distant — le code département
n'étant pas déductible du chemin.

```bash
# couvreur/gironde/.site
DOMAIN="couvreur-gironde-33.fr"
DEP="33"
DEP_NOM="Gironde"
```

---

## 4. Le routeur `.htaccess`

Il y a **deux** `.htaccess`, un par vhost. Les deux sont générés par `build.sh`
depuis `_shared/` et **écrasés à chaque build** — ne jamais éditer les fichiers
générés, seulement les modèles.

| Modèle | Généré dans | Rôle |
|---|---|---|
| `_shared/htaccess-villes.tpl` | `_villes/.htaccess` | routeur wildcard + HTTPS |
| `_shared/htaccess-root.tpl` | `_root/.htaccess` | apex : HTTPS + www→non-www |
| `_shared/404.html` | `_root/` et `_villes/` | page d'erreur des deux vhosts |

L'apex avait longtemps été oublié : sans `.htaccess`, le site départemental
restait servi en http **et** en https, donc indexable deux fois.

`build.sh` y substitue `__DOMAIN_REGEX__` et écrit le résultat dans
`_villes/.htaccess`.

```apache
RewriteEngine On
Options -Indexes

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

# 7 — HTTPS : à décommenter APRÈS génération du certificat
# RewriteCond %{HTTPS} !=on
# RewriteCond %{REQUEST_URI} !^/\.well-known/
# RewriteRule ^(.*)$ https://%{HTTP_HOST}/$1 [R=301,L]

ErrorDocument 404 /404.html
```

**Trois points non négociables si tu modifies ce fichier :**

- La règle **0** (redirection HTTPS) doit rester la **première**. Placée après le
  routage, elle s'exécute sur une passe interne et redirige vers le chemin
  *réécrit* : `http://bordeaux.…/toiture` partirait en 301 vers
  `https://bordeaux.…/bordeaux/toiture.html`. Le chemin interne fuiterait dans
  l'URL publique — et c'est cette URL que Google indexerait. Elle utilise
  `%{REQUEST_URI}`, qui conserve l'URI d'origine.

- La règle 1 doit conserver le test `%{ENV:REDIRECT_STATUS} ^$`. C'est lui qui
  empêche la boucle infinie : après la réécriture interne de la règle 5, Apache
  réévalue le `.htaccess`, et sans ce garde-fou il réécrirait
  `/bordeaux/bordeaux/…` indéfiniment → erreur 500.
- Le passage par la variable d'environnement `VILLE` (règle 1) est nécessaire :
  une backréférence `%1` de `RewriteCond` n'est plus fiable dès qu'une condition
  suivante ne contient pas de groupe de capture.

---

## 5. Les scripts

### `build.sh <metier>/<departement>`

Génère et met en forme. **Ne déploie rien.**

1. lit `.site`, en déduit `DOMAIN`, `DEP`, `DEP_NOM`, et le métier depuis le chemin
2. **purge** `output/<DEP>-<slug>` et `output/<DEP>-<slug>-dep` — la sortie du
   générateur est cumulative, sans ça les fichiers d'un build précédent survivent
3. lance `generate-dep.js` puis `generate.js --depdir …` dans `<metier>/_generator`
4. rsync local : sortie départementale → `_root/`, communes → `_villes/`
   (les assets sont déjà mutualisés par le générateur — voir §7)
5. génère `_villes/.htaccess` depuis le modèle
6. affiche un bloc de contrôle : communes, fichiers, poids, routeur, assets
   partagés, budget projeté à 95 départements, et une alerte si un asset partagé
   est référencé en relatif

Variable à ajuster si le générateur nomme ses sorties autrement :
`VILLES_OUT="$GEN/output/${DEP}-${SLUG}"`.

### `subdomains.sh <metier>/<departement> [--create|--remove-wildcard]`

Déclare un vhost cPanel par commune, via UAPI en SSH.

```bash
./subdomains.sh couvreur/gironde                    # état : déclarés / manquants
./subdomains.sh couvreur/gironde --create           # crée les manquants
./subdomains.sh couvreur/gironde --remove-wildcard  # retire le vhost « * »
```

Sans argument d'action, il ne fait que comparer les communes construites en local
aux sous-domaines déclarés sur le serveur. `--remove-wildcard` **refuse** de
s'exécuter tant qu'une commune n'a pas son vhost : retirer le `*` avant rendrait
ces communes injoignables.

### `ssl-check.sh [<metier>/<departement>]`

Tableau de bord des certificats et des redirections, vu de l'extérieur — aucun
accès SSH requis. Sans argument, parcourt tous les `.site` du dépôt.

Pour chaque domaine : certificat de l'apex, du `www` et d'une commune réellement
déployée ; puis les redirections HTTP → HTTPS. Il vérifie **l'émetteur et la
chaîne de confiance**, pas seulement la date — un certificat auto-signé cPanel a
une date valide et n'est accepté par aucun navigateur.

Sort en `1` dès qu'un point demande une action : certificat auto-signé, expirant
sous 30 jours, expiré, ou HTTP répondant encore en 200.

### `deploy.sh <metier>/<departement> [_root|_villes]`

Envoie par rsync. `DRY=1` pour simuler.

- `_root/` → `sites/<DOMAIN>/_root/`
- `_villes/` → `sites/<DOMAIN>/villes/`
- `--delete` actif : ce qui disparaît en local disparaît en ligne
- exclusions `.git`, `.DS_Store`, `.site`, `node_modules`, `.env`
- exclusions **`.well-known/`** et **`cgi-bin/`** : ces dossiers appartiennent au
  serveur et n'existent pas en local, donc `--delete` les effacerait à chaque
  déploiement. `.well-known/` porte la validation HTTP-01 de Let's Encrypt —
  l'effacer pendant un renouvellement le fait échouer, et comme le renouvellement
  est manuel, rien ne rattraperait le coup
- `--rsync-path="mkdir -p … && rsync"` crée le dossier distant au besoin
- `--all` parcourt tous les `.site` trouvés
- contrôle SSH avant tout transfert, avec la marche à suivre en cas d'échec

**Deux rsync possibles.** Depuis macOS Sequoia, `/usr/bin/rsync` n'est plus le
vrai rsync mais **openrsync**, qui refuse `--chmod` et `--info` :

```
rsync: --chmod=D755,F644: invalid argument
```

`deploy.sh` détecte la variante au lieu de la supposer, et affiche laquelle il
utilise (`[openrsync]` ou `[rsync]`). Avec openrsync il transmet les droits
locaux (`-p`) au lieu de les imposer — ce sont donc ceux de l'arborescence locale
qui comptent, et **`build.sh` les normalise** à 755/644 en fin de mise en forme.
Sans cette normalisation, des images arrivaient en 664, inscriptibles par le
groupe, ce qui n'a rien à faire sur un mutualisé.

`brew install rsync` rétablit le rsync complet ; `deploy.sh` le préférera
automatiquement. On peut aussi forcer un binaire : `RSYNC_BIN=/chemin/rsync`.

**`DRY=1` systématique sur un nouveau domaine.** `--delete` sur une source
incomplète vide le site en ligne.

### Accès SSH

`~/.ssh/config` :

```
Host o2
    HostName aubergine.o2switch.net
    User movi6707
    Port 22
    IdentityFile ~/.ssh/o2switch
    IdentitiesOnly yes
    UseKeychain yes
    AddKeysToAgent yes
```

L'avertissement OpenSSH sur l'absence d'échange post-quantique est sans
conséquence : le serveur o2switch tourne une version plus ancienne.

#### Autorisation par IP — la contrainte à comprendre une fois

**Chez o2switch, le port 22 est fermé par défaut**, pour SSH comme pour le sFTP.
Une IP non autorisée ne reçoit pas de refus : ses paquets sont *jetés en
silence*, donc `ssh` part en **timeout**. C'est le comportement normal, pas le
signe d'un bannissement — inutile de contacter le support, l'outil est en
libre-service : cPanel → **Autorisation SSH**.

Deux limites à connaître :

- **5 autorisations maximum.** Elles se remplissent vite d'IP mortes si l'accès
  Internet est en IP dynamique. Supprimer les anciennes en ajoutant les nouvelles.
- Chaque autorisation existe en **connexion entrante et sortante** — déclarer les
  deux.

**Solution durable pour une IP dynamique.** L'outil accepte un **nom DNS
dynamique** (NoIP, DynDNS…) à la place d'une IP fixe. Un compte gratuit, un nom
du type `xxx.ddns.net` qui suit l'IP automatiquement, autorisé une seule fois :
plus aucune manipulation ensuite. C'est le bon réglage dès que l'IP change
plusieurs fois par mois.

Diagnostic express quand `ssh o2` expire :

```bash
curl -s https://ifconfig.me; echo               # l'IP à autoriser
nc -z -w 6 aubergine.o2switch.net 2083 && echo "serveur joignable"
nc -z -w 6 github.com 22        && echo "port 22 sortant OK de mon côté"
```

Si le serveur répond sur 2083 et que le port 22 sort bien vers GitHub, alors le
seul point restant est l'autorisation de l'IP courante.

---

## 6. Procédures

### Nouveau département (métier déjà en place)

```bash
BASE=~/Desktop/Coding/Sites-O2Switch
mkdir -p "$BASE/couvreur/charente"
printf 'DOMAIN="couvreur-charente-16.fr"\nDEP="16"\nDEP_NOM="Charente"\n' > "$BASE/couvreur/charente/.site"
```

Dans cPanel (ou par UAPI en SSH) :

```bash
ssh o2 "uapi SubDomain addsubdomain domain='*' rootdomain=couvreur-charente-16.fr dir=/sites/couvreur-charente-16.fr/villes"
```

Le domaine lui-même se crée dans cPanel → Domaines → Créer un domaine, en
décochant « Partager le répertoire racine » et en visant
`/home/movi6707/sites/couvreur-charente-16.fr/_root`.

Puis suivre la mise en ligne ci-dessous, dans l'ordre.

### Mise en ligne — l'ordre compte

> **Règle absolue : le HTTP ne doit jamais être indexé.** Un site servi en clair
> pendant que Google le découvre finit indexé deux fois, en `http://` et en
> `https://`. Le seul remède fiable est un **301 vers HTTPS** ; mais il ne peut
> être activé qu'une fois le certificat en place, sinon les visiteurs tombent sur
> un avertissement de sécurité. D'où cet ordre : **on ne soumet rien à Google
> tant que la redirection n'est pas active.**

Les étapes 1 à 5 se font sans que le site soit connu de Google : domaine neuf,
aucun lien entrant, aucun sitemap soumis. La fenêtre HTTP existe, mais personne
ne la voit.

**0. Autoriser l'IP courante** — le port 22 est fermé par défaut chez o2switch, et
l'IP publique change (box, VPN, 4G). Sans cette étape, `deploy.sh` part en
timeout. Voir §5 pour le détail, y compris l'option DynDNS qui évite d'y revenir.

cPanel → **Autorisation SSH** → ajouter l'IP retournée par :

```bash
curl -s https://ifconfig.me; echo
ssh o2 'echo OK'          # doit répondre OK
```

**1. Créer les deux vhosts** (manuel, cPanel)

| Ce qu'on crée | Où | Racine du document |
|---|---|---|
| le domaine | Domaines → **Créer un domaine** | `/home/movi6707/sites/<DOMAIN>/_root` |
| le sous-domaine `*` | Domaines → **Créer un domaine**, nom `*.<DOMAIN>` | `/home/movi6707/sites/<DOMAIN>/villes` |

Dans les deux cas, **décocher « Partager le répertoire racine »** (*Share document
root*) : c'est cette case qui replacerait la racine dans `public_html`, et le
contenu ressortirait aussi sur `movi6707.odns.fr` — duplicate content sur tout le
réseau (§3).

Le sous-domaine wildcard peut aussi se créer en SSH :

```bash
ssh o2 "uapi SubDomain addsubdomain domain='*' \
  rootdomain=couvreur-gironde-33.fr \
  dir=/sites/couvreur-gironde-33.fr/villes"
```

Contrôler que les deux racines sont correctes :

```bash
ssh o2 "uapi --output=jsonpretty DomainInfo domains_data" \
  | grep -E '\"domain\"|documentroot'
```

**2. Vérifier les DNS** — le wildcard exige la validation DNS-01, donc les
serveurs d'o2switch :

```bash
dig +short NS couvreur-gironde-33.fr     # attendu : ns1/ns2.o2switch.net
```

**3. Générer et déployer**

```bash
cd ~/Desktop/Coding/Sites-O2Switch
./build.sh couvreur/gironde
DRY=1 ./deploy.sh couvreur/gironde       # systématique sur un nouveau domaine
./deploy.sh couvreur/gironde
```

Le bloc de contrôle doit afficher `https _villes : inactive` — c'est normal à ce
stade, la redirection s'active à l'étape 6.

**4. Tester le routage en HTTP** (§ « Vérifications » ci-dessous). C'est la seule
raison pour laquelle le HTTP reste ouvert à ce stade.

**4 bis. Déclarer les sous-domaines** — un vhost par commune (§2) :

```bash
./subdomains.sh couvreur/gironde            # état
./subdomains.sh couvreur/gironde --create   # crée les 249
```

Vérifier ensuite que tout est déclaré, puis seulement retirer le wildcard :

```bash
./subdomains.sh couvreur/gironde --remove-wildcard
```

**5. Émettre les certificats** (manuel, cPanel → SSL/TLS → Let's Encrypt™)

**250 certificats** : l'apex (+ `www`) et un par commune, tous en validation
**http-01**.

Let's Encrypt applique un plafond hebdomadaire par domaine racine, dont la
valeur a évolué : **ne pas planifier dessus** (voir §2). Émettre jusqu'au refus,
dont le message est explicite.

- Inutile de simuler à chaque fois : un échec ne consomme rien. Vérifier plutôt
  que le **DNS est propagé** avant d'émettre — `golive.sh` le fait et affiche
  `DNS propagé (4/4)`. C'est la cause réelle des échecs `NXDOMAIN`.
- Un certificat ne s'installe que sur un **vhost déclaré** — d'où l'étape 4 bis.
- Adresse de notification : **rachdevcodeur@gmail.com** (voir « Renouvellement »).

`./ssl-check.sh` après chaque vague pour voir où en est la couverture.

> **Attention au faux positif.** cPanel installe d'office un certificat
> **auto-signé** sur chaque vhost neuf. Il a une date de fin parfaitement valide
> (souvent un an) et pourtant aucun navigateur ne l'accepte. Regarder la date ne
> suffit donc pas : il faut vérifier **l'émetteur** et la chaîne de confiance.

Contrôle — `./ssl-check.sh` le fait pour tous les domaines, ou à la main :

```bash
h=bordeaux.couvreur-gironde-33.fr
echo | openssl s_client -connect "$h:443" -servername "$h" 2>&1 \
  | grep -E 'issuer=|subject=|Verify return code'
```

Attendu : `issuer=` un nom de Let's Encrypt (`R10`, `R11`, `YR2`…) — **jamais le
nom du domaine lui-même**, qui signerait un auto-signé — et
`Verify return code: 0 (ok)`.

Côté serveur, la liste de ce qui est réellement installé :

```bash
ssh o2 "uapi --output=jsonpretty SSL installed_hosts" | grep -E '\"domains\"|issuer|not_after'
```

**6. Activer la redirection HTTPS** — dans les **modèles**, jamais dans les
fichiers générés :

- `_shared/htaccess-villes.tpl` → décommenter les 3 lignes de la règle **0** ;
- `_shared/htaccess-root.tpl` → décommenter les blocs **1a** et **1b**.

Puis :

```bash
./build.sh couvreur/gironde      # doit afficher « https _villes : ACTIVE »
./deploy.sh couvreur/gironde
```

**7. Contrôler la redirection** avant toute soumission à Google :

```bash
for u in http://couvreur-gironde-33.fr/ \
         http://www.couvreur-gironde-33.fr/ \
         https://www.couvreur-gironde-33.fr/ \
         http://bordeaux.couvreur-gironde-33.fr/ \
         http://bordeaux.couvreur-gironde-33.fr/toiture; do
  printf '%-52s -> %s %s\n' "$u" \
    "$(curl -s -o /dev/null -w '%{http_code}' "$u")" \
    "$(curl -s -o /dev/null -w '%{redirect_url}' "$u")"
done
```

Attendu : **301** partout, vers l'URL `https://` **sans www** et **avec le même
chemin**. Si une redirection ajoute `/bordeaux/` dans l'URL, la règle HTTPS
n'est pas en première position — voir §4.

Vérifier aussi qu'il n'y a **qu'un seul saut** (pas de chaîne 301→301) :

```bash
curl -sIL http://www.couvreur-gironde-33.fr/ | grep -i '^HTTP/\|^location:'
```

**8. Seulement maintenant, Search Console** — voir la section dédiée.

### Nouveau métier

Copier son générateur dans `<metier>/_generator/` en excluant `output/`,
`output-urls/`, `node_modules/`, `.git/`. Recréer les symlinks de données.
Le reste est identique.

Le template du métier (`index.html`, `style.css`, `script.js`,
`data/variables.json`, `public/images/`) vit dans ce `_generator/` et **nulle
part ailleurs** — surtout pas à la racine du dépôt, où il serait ambigu dès le
deuxième métier. Reprendre les points acquis sur le couvreur :

- chemins d'assets absolus `/assets/…` et assets mutualisés (§7) ;
- `--domain` transmis par `build.sh`, jamais de domaine codé en dur ;
- formes déclinées `{DEP_NOM_A}` / `{DEP_NOM_DE}`, jamais `du {DEP_NOM}` ;
- JSON-LD généré depuis les variantes retenues, pas figé dans le template.

### Vérifications après déploiement

Avant le certificat (étape 4), le site répond encore en clair :

```bash
curl -sI http://bordeaux.couvreur-gironde-33.fr | head -1                   # 200
curl -sI http://commune-inexistante.couvreur-gironde-33.fr | head -1        # 404, pas 500
curl -sI http://bordeaux.couvreur-gironde-33.fr/assets/style.css | head -1  # 200
curl -s  http://bordeaux.couvreur-gironde-33.fr/ | grep -o 'canonical[^>]*' # https://…
```

Après l'étape 6, ces mêmes URLs doivent renvoyer **301**, pas 200.

### Renouvellement SSL — manuel

Adresse de notification : **rachdevcodeur@gmail.com**

- cPanel → **Informations de contact** : mettre cette adresse comme e-mail du
  compte et laisser cochées les notifications liées aux certificats (expiration
  proche, échec de renouvellement).
- Le générateur Let's Encrypt demande aussi une adresse à l'émission : la même.

**Rendre le renouvellement manuel.** Par défaut cPanel renouvelle seul via
AutoSSL. Pour reprendre la main : cPanel → **SSL/TLS Status**, cocher les
domaines concernés → **Exclude Domains from AutoSSL**. Vérifier ensuite que la
colonne AutoSSL indique bien l'exclusion.

**Le cycle.** Let's Encrypt émet pour **90 jours**. Le rappel se met donc à
J+60 environ, pas plus tard :

```bash
./ssl-check.sh                    # tous les domaines
./ssl-check.sh couvreur/gironde   # un seul
```

Le script signale tout certificat expirant sous 30 jours, tout certificat
auto-signé et toute redirection HTTP manquante. Il sort en `1` s'il y a quelque
chose à traiter.

**La procédure**, identique à l'émission initiale : cPanel → SSL/TLS →
Let's Encrypt™ → le domaine → « Renouveler » (dns-01 pour le wildcard, http-01
pour l'apex), puis `./ssl-check.sh` pour confirmer la nouvelle date. Aucun
rebuild ni redéploiement n'est nécessaire : le certificat vit côté serveur, les
fichiers du site ne changent pas.

> **Le point à regarder en face.** 90 jours, deux certificats par domaine. Sur un
> seul département c'est confortable. À 95 départements × 6 métiers, cela ferait
> plus de mille renouvellements manuels par an — et un oubli ne dégrade pas le
> site, il le rend inaccessible, avec un avertissement de sécurité en pleine page.
> Tant qu'on reste sur quelques domaines, le manuel est le bon choix : on maîtrise
> et on vérifie. Au-delà, la voie raisonnable est de **réactiver AutoSSL** et de
> garder `ssl-check.sh` comme contrôle — on garde la visibilité sans porter le
> risque d'oubli. À rouvrir au 3ᵉ ou 4ᵉ domaine, pas avant.

### Search Console

**Une seule propriété de domaine par domaine** (validation TXT dans cPanel →
Éditeur de zone), pas des propriétés URL. Une validation couvre l'apex et les
249 sous-domaines.

C'est aussi le bon choix pour le sujet HTTP/HTTPS : une propriété de domaine
regroupe les deux protocoles, donc les rapports montrent d'emblée si une URL en
clair traîne encore dans l'index.

- Ne soumettre les sitemaps **qu'après** l'étape 7 — un sitemap soumis pendant la
  fenêtre HTTP, c'est exactement l'invitation à indexer le clair.
- Sitemaps à soumettre : `https://couvreur-gironde-33.fr/sitemap.xml`, et le
  sitemap de chaque commune si besoin (`https://<commune>.<domaine>/sitemap.xml`).
- Si des URLs `http://` sont déjà indexées d'un déploiement précédent : ne rien
  supprimer manuellement. Le 301 suffit, Google consolide vers l'HTTPS en
  quelques semaines. L'outil de suppression ne ferait que masquer l'URL 6 mois
  sans régler la cause.

---

## 7. Le budget fichiers — contrainte dimensionnante

Rappel du seuil : **100 000 fichiers par compte cPanel**, au-delà duquel
o2switch n'archive plus les sauvegardes.

| Stratégie | 1 département (Gironde, 249 communes) | 95 départements |
|---|---|---|
| assets copiés dans chaque commune | 4 005 *(mesuré)* | ~380 000 |
| **assets mutualisés à la racine** | **779** *(mesuré)* | **~74 000** |

Chiffres mesurés, pas estimés — `build.sh` les affiche à chaque build (ligne
`budget`). Gironde est un gros département : 779 est un majorant.

### Comment la mutualisation est implémentée

C'est **le générateur** qui la porte, pas `build.sh` :

- `writeSharedAssets()` écrit `assets/` **une seule fois** à la racine de la
  sortie du département — soit la racine du document root wildcard une fois
  déployé. Contenu : `style.css`, `script.js`, `images/`.
- `absolutizeAssets()` réécrit les références du HTML en **chemin absolu**
  `/assets/…`. La règle 3 du routeur laisse passer `^assets/` sans la réécrire
  vers le dossier de la commune — d'où le choix de ce préfixe précis.
- Il reste **3 fichiers par commune** : `index.html`, `sitemap.xml`, `robots.txt`.

**Le mécanisme d'override par ville est préservé.** Si
`_generator/public/images/villes/{slug}/{nom}.webp` existe, cette image reste en
chemin **relatif** (`public/images/{nom}.webp`) et est copiée dans le dossier de
la commune : la règle 5 la résout alors vers `/{ville}/public/images/…`.
Absolu = mutualisé, relatif = propre à la ville. Aucun override n'existe
aujourd'hui, mais ne pas casser cette distinction en « simplifiant ».

Le template `index.html` du générateur garde, lui, des chemins relatifs : il
reste ouvrable tel quel dans un navigateur. La réécriture se fait à la
génération, pas dans le template. `absolutizeCss()` traite en plus le
`url()` de l'image de bannière dans `style.css`, qui est servi depuis
`/assets/` et casserait en relatif.

**Prévisualiser une page générée** — l'ouvrir en `file://` ne marche pas, les
chemins `/assets/…` pointeraient vers la racine du disque. Servir `_villes/` :

```bash
cd couvreur/gironde/_villes && python3 -m http.server 8000
# puis http://localhost:8000/bordeaux/
```

**Vérification avant tout déploiement massif :**

```bash
# doit ne rien renvoyer : aucun asset partagé référencé en relatif
grep -l '="style\.css"\|="public/js/' couvreur/gironde/_villes/*/index.html

# doit renvoyer uniquement des chemins /assets/…
grep -oh 'href="[^"]*\.css"' couvreur/gironde/_villes/*/index.html | sort -u
```

`build.sh` fait ce contrôle automatiquement et affiche `ATTENTION` s'il échoue.
Ne pas contourner en désactivant la mutualisation — ça repousse le problème de
95 départements à 25.

**Marge restante.** 74 000 fichiers pour un métier sur 95 départements. Les 6
métiers visés ne tiennent donc pas sur un seul compte cPanel (~444 000) : il
faudra bien répartir sur les 4 Lunes (~111 000 chacune, encore un peu au-dessus
du seuil) et considérer Git comme la sauvegarde réelle plutôt que les archives
o2switch. À rouvrir au 2ᵉ ou 3ᵉ métier, pas avant.


---

## 8. État d'avancement

**Fait**

- Compte cPanel `movi6707` sur le serveur `aubergine` (`aubergine.o2switch.net:2083`)
- Accès SSH opérationnel : IP whitelistée, clé `~/.ssh/o2switch` importée et autorisée, alias `o2`
- Domaine `couvreur-gironde-33.fr` rattaché, DNS sur `ns1/ns2.o2switch.net` (vérifié par `dig NS`)
- Vhost du domaine recréé avec docroot dédié (`sites/couvreur-gironde-33.fr/_root`), sorti de `public_html`
- Vhost wildcard `*.couvreur-gironde-33.fr` créé, docroot `sites/couvreur-gironde-33.fr/villes`
- Arborescence locale en place, dépôt Git initialisé
- Générateur couvreur installé dans `couvreur/_generator/`, symlinks de données recréés
- **La génération fonctionne**
- **Chemins d'assets réglés (§7)** : ils étaient relatifs et la mutualisation ne
  s'appliquait jamais (le générateur n'émettait aucun dossier `assets/`, donc le
  bloc de dédoublonnage de `build.sh` était inerte). Le générateur écrit
  désormais `assets/` une fois et référence `/assets/…` en absolu.
  Gironde : **4 005 → 779 fichiers**, 81 Mo → 13 Mo.
- Contrôle de `build.sh` vérifié : 249 communes, routeur OK, assets partagés OK
- **Template `couvreur 2` en place** : nouveau design, 60 slots de texte × 5
  variantes, JSON-LD FAQ généré depuis les variantes réellement affichées.
  Vérifié en servant `_villes/` en HTTP : 0 référence cassée sur les 249 pages.
- **Domaine corrigé** : les deux générateurs écrivaient des canonical et sitemaps
  vers `couvreurXX-pro.fr`, codé en dur. `build.sh` passe désormais `--domain`
  depuis le `.site`, côté communes **et** côté départemental.
- **Chaîne HTTPS prête** : redirection remontée en 1re règle du routeur,
  `.htaccess` créé pour l'apex (il n'en avait aucun), page 404 des deux vhosts,
  et contrôle `https _villes / _root` dans la sortie de `build.sh`.
  Les redirections restent **commentées** — à activer à l'étape 6 du §6.

**État constaté côté serveur** (vérifié le 2026-08-09 avec `ssl-check.sh`)

| Vhost | Contenu | Certificat |
|---|---|---|
| `couvreur-gironde-33.fr` | vide (« Index of / ») | Let's Encrypt, valide jusqu'au 6 nov. 2026 |
| `*.couvreur-gironde-33.fr` | vide | **auto-signé cPanel** — le vrai wildcard reste à émettre |

Les deux vhosts répondent en **HTTP 200** : rien n'est encore déployé, donc rien
à indexer pour l'instant, mais la redirection devra être active avant toute
soumission à Search Console.

L'accès SSH est **coupé** (timeout) : l'IP publique a changé, à réautoriser dans
cPanel avant tout déploiement — voir l'étape 0 du §6.

**Reste à faire, dans l'ordre**

1. Réautoriser l'IP SSH dans cPanel (`ssh o2 'echo OK'` doit répondre)
2. `DRY=1 ./deploy.sh couvreur/gironde` puis déploiement réel
3. Tester le routage **en HTTP** avant tout SSL — §6
4. Émettre le wildcard (dns-01) — il remplacera l'auto-signé
5. Décommenter les redirections HTTPS dans les modèles, rebuild, redeploy
6. `./ssl-check.sh` : tout doit être vert
7. Search Console, sitemaps — **et pas avant l'étape 6**

---

## 9. Points ouverts

**Symlinks vers « Template Peintres France ».** `couvreur/json-communes` et
`couvreur/data` pointent vers le dossier Cursor. Fonctionne, mais un
déplacement ou un renommage casse la génération sans message clair.
À terme : copier les données dans `_shared/data-communes/` et lier depuis là.

**Six générateurs, six copies de `communes.json` (11 Mo).** Dès le deuxième
métier migré, sortir `data/communes.json` dans `_shared/` et le lier par symlink.
C'est exactement le doublon qui avait déjà été éliminé côté `../json-communes/`.

**Variantes multiples dans le dossier source.** `couvreur`, `couvreur 2`,
`couvreur-autonome`, `peintre-en-batiment2`, `peintre-en-batiment3`…
Piège avéré : `couvreur-autonome` est une version **mono-commune** sans
`generate-dep.js` — ce n'est pas le générateur départemental. Identifier la
version qui fait foi avant chaque migration de métier.

Tranché pour le couvreur : le **template** vient de
`sites-villes-ovh/couvreur 2/` (deux copies existent, l'autre est
`Templates/couvreur 2/` dont l'`index.html` diverge — ne pas s'en servir).
Son `generate.js` est mono-commune : seuls le template, `variables.json`,
`script.js`, `style.css` et les images ont été repris. Le moteur reste
`_generator/generate.js`, départemental.

**`.env` Supabase.** Il vit dans `<metier>/.env` — c'est là que le générateur le
cherche (`path.resolve(__dirname, '..', '.env')`), pas dans `_generator/`.
Ne doit jamais partir en ligne ni dans Git : `deploy.sh` l'exclut, `.gitignore`
le couvre (vérifié par `git check-ignore`). Clés attendues :

```bash
SUPABASE_URL=…
SUPABASE_ANON_KEY=…
SUPABASE_TABLE_COUVREUR=leads_couvreur
SUPABASE_USE_RELATIVE_API=0      # impératif — voir l'erreur 405 ci-dessus
```

La clé `anon` se retrouve en clair dans les 249 pages : c'est son usage normal,
mais elle n'est sûre **que** si la table est protégée par une politique RLS
n'autorisant que l'INSERT. À vérifier côté Supabase avant la mise en ligne.

**Erreur 405 sur les sites en production — traité pour le couvreur (2026-08-09).**
Le `.env` hérité d'OVH portait `SUPABASE_USE_RELATIVE_API=1` : en mode relatif le
formulaire poste vers `/rest/v1/…` sur le domaine du site lui-même, qui est
statique — d'où le 405. `couvreur/.env` force désormais `=0`, donc l'URL absolue
de Supabase. Reste à appliquer aux autres métiers lors de leur migration.

---

## 10. Pièges rencontrés — à ne pas refaire

| Symptôme | Cause | Correctif |
|---|---|---|
| `ssh`/`rsync` timeout | IP publique changée — le port 22 est fermé par défaut, l'IP non autorisée est jetée en silence | cPanel → **Autorisation SSH** (libre-service, pas le support) ; à terme, y déclarer un nom DynDNS plutôt qu'une IP — §5 |
| On cherche l'autorisation SSH dans « Bloqueur d'adresses IP » | deux fonctions distinctes | le Bloqueur refuse des **visiteurs du site** ; y mettre son IP se coupe l'accès à ses propres sites |
| `--chmod=D755,F644: invalid argument` | macOS fournit openrsync, pas rsync | détection automatique dans `deploy.sh` ; `brew install rsync` pour le vrai |
| Fichiers en 664 en ligne | openrsync transmet les droits locaux | `build.sh` normalise en 755/644 |
| Renouvellement HTTP-01 qui échoue après un déploiement | `--delete` a effacé `.well-known/` du serveur | exclu dans `deploy.sh` — vérifier `DRY=1` avant tout ajout d'exclusion |
| `Could not resolve hostname o2` | bloc absent de `~/.ssh/config` | vérifier avec `ssh -G o2` |
| Erreur 500 sur un sous-domaine | boucle de réécriture | garde-fou `REDIRECT_STATUS` en règle 1 |
| Le wildcard SSL échoue | domaine pas sur les DNS o2switch | `dig NS`, corriger, attendre |
| Blocage « rate limit » Let's Encrypt | tentatives répétées | attendre 7 jours ; toujours simuler d'abord |
| `cp -R` qui ne finit jamais | `output/` accumulé dans la source | `rsync` avec exclusions, interruptible |
| Fichiers d'un ancien build qui réapparaissent | la sortie du générateur est cumulative | `build.sh` purge `output/<DEP>-<slug>*` avant de générer |
| `build.sh` sort en erreur sans rien dire | `set -o pipefail` + un `grep` sans correspondance | `{ grep … \|\| true; } \| wc -l` |
| Images/CSS en 404 sur les communes | asset partagé référencé en relatif | chemins `/assets/…` absolus — §7 |
| Google indexe le site en http **et** en https | pas de 301, ou sitemap soumis avant sa mise en place | activer la règle 0, puis Search Console — §6 |
| Le 301 ajoute `/bordeaux/` dans l'URL | redirection HTTPS placée après le routage | elle doit être la 1re règle — §4 |
| Site départemental indexé en http | `_root/` n'avait aucun `.htaccess` | `_shared/htaccess-root.tpl` — §4 |
| « du Gironde », « dans le Ain » | `{DEP_NOM}` nu après une préposition | `{DEP_NOM_A}` / `{DEP_NOM_DE}` — §3 |
| Canonical vers un autre domaine | domaine codé en dur dans `buildUrl()` | `build.sh` passe `--domain` depuis `.site` |
| Page nue en l'ouvrant en `file://` | les `/assets/…` visent la racine du disque | servir `_villes/` en HTTP — §7 |
| `MODULE_NOT_FOUND` sur `generate-dep.js` | mauvaise variante du générateur | vérifier la présence du fichier avant de relancer |
| Contenu servi en double | docroot dans `public_html` | docroot dédié hors `public_html` |
