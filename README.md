# Réseau de sites locaux — o2switch

Génération et mise en ligne d'un réseau de sites statiques, un par commune :

```
{commune}.{domaine-du-departement}.fr
```

Deux métiers en service, chacun sur un compte cPanel distinct :

| Métier | Domaine | Compte cPanel |
|---|---|---|
| Couvreur | `couvreur-gironde-33.fr` | `movi6707` |
| Peintre | `artisan-peintre-pro-33.fr` | `movi4314` |

**La documentation complète est dans [PROJET-O2SWITCH.md](PROJET-O2SWITCH.md).**
À lire avant toute modification : plusieurs choix qui semblent perfectibles sont
en réalité contraints par l'hébergement mutualisé, et le document explique
pourquoi.

---

## Démarrer sur une nouvelle machine

**1. Cloner**

```bash
git clone <url-du-depot> Sites-O2Switch
cd Sites-O2Switch
```

Les données communes (19 Mo) sont dans le dépôt : rien à installer.

**2. Les clés Supabase**

Elles ne sont pas versionnées. Demander les valeurs à un membre de l'équipe :

```bash
cp couvreur/.env.example couvreur/.env
cp peintre/.env.example  peintre/.env
# puis renseigner SUPABASE_ANON_KEY dans chacun
```

**3. L'accès SSH**

Ajouter dans `~/.ssh/config` :

```
Host o2
    HostName aubergine.o2switch.net
    User movi6707
    Port 22
    IdentityFile ~/.ssh/o2switch
    IdentitiesOnly yes

Host o2-peintre
    HostName aubergine.o2switch.net
    User movi4314
    Port 22
    IdentityFile ~/.ssh/o2switch
    IdentitiesOnly yes
```

Puis, **sur chacun des deux comptes cPanel** :

- Gérer les clés SSH → importer sa clé publique, puis **Autoriser**
- Autorisation SSH → ajouter son IP, obtenue par `curl -s https://ifconfig.me`

Ces deux réglages sont propres à chaque compte : ceux d'une Lune ne valent pas
pour l'autre.

**4. Vérifier**

```bash
ssh o2 'echo OK'
ssh o2-peintre 'echo OK'
./sync.sh --local          # régénère tout, sans rien envoyer
```

---

## Au quotidien

| Commande | Effet |
|---|---|
| `./sync.sh` | pull, build, deploy, tableaux de bord — tout, tous les métiers |
| `./sync.sh peintre/gironde` | idem, un seul département |
| `./sync.sh --local` | régénère et vérifie, sans rien envoyer |
| `./golive.sh <metier>/<dep> <commune>` | où en est une commune, et quoi faire ensuite |
| `./ssl-check.sh` | état des certificats et des redirections |
| `./subdomains.sh <metier>/<dep>` | vhosts déclarés / manquants |

Mettre une commune en ligne se fait en quatre étapes, détaillées par :

```bash
./golive.sh peintre/gironde bordeaux --etapes
open peintre/cmd.html      # la même chose, avec boutons copier
```

---

## Ce qui est versionné, ce qui ne l'est pas

**Versionné** — les sources : générateurs, templates, variantes de texte, images,
données communes, fichiers `.site`, et `.https-actives` qui recense les communes
réellement passées en HTTPS.

**Pas versionné** — les `.env` (secrets), et tout ce que `./build.sh` reconstruit :
`_root/`, `_villes/`, `_generator/output/`. Ces dossiers pèseraient des
gigaoctets pour un contenu régénérable en quelques secondes.

**Conséquence pratique :** après un `git pull`, lancer `./sync.sh` pour
reconstruire à partir des sources mises à jour par les autres.

---

## À ne pas faire

- **Ne jamais committer un `.env`.** La clé Supabase se retrouverait dans
  l'historique, où elle survivrait à toute suppression ultérieure.
- **Ne jamais éditer les fichiers générés** — `_villes/.htaccess`, `_root/`,
  `output/`. Ils sont écrasés au build suivant. Modifier les modèles dans
  `_shared/` ou les templates dans `<metier>/_generator/`.
- **Ne pas activer une redirection HTTPS avant le certificat.** `golive.sh`
  refuse de le faire, ne pas contourner : un visiteur verrait un avertissement
  de sécurité en pleine page.
