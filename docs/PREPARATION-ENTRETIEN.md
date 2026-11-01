# AURA — Préparer l'entretien

Document de révision : ce que fait le projet, comment les morceaux s'emboîtent, pourquoi ces choix, et comment répondre aux questions techniques. À lire dans l'ordre ; les mots en **gras** sont expliqués dans le glossaire à la fin.

---

## 1. Le pitch (30 secondes)

> « AURA est une boutique en ligne fictive de lunettes de soleil. Le site est en HTML, CSS et JavaScript, sans framework, publié sur GitHub Pages. Le paiement passe par Stripe en mode test. Les automatisations sont faites avec n8n, que j'héberge sur un serveur : création du paiement, enregistrement de la commande en base et emails au client. Les commandes sont stockées dans une base PostgreSQL chez Neon. Les clients ont un espace pour suivre leurs commandes, et j'ai un back-office pour les expédier. La sécurité des données est gérée directement par la base de données. »

Ce qu'il faut faire passer : **un vrai parcours complet**, du clic « Payer » jusqu'à l'email « votre commande est en route », avec de la vraie sécurité.

---

## 2. Vue d'ensemble

```
            ┌──────────────────────── Navigateur (site statique, GitHub Pages) ────────────────────────┐
            │  index / shop / panier      checkout.html      compte.html   mes-commandes   admin.html   │
            └───────┬───────────────────────────┬──────────────────┬─────────────┬───────────┬─────────┘
                    │ panier en localStorage    │                  │             │           │
                    │                           ▼                  ▼             ▼           ▼
                    │                    n8n « Créer session »   Neon Auth   Neon Data API (lecture,
                    │                           │                (comptes)   changement de statut)
                    │                           ▼                                          │
                    │                  Stripe Checkout (paiement test)                     │ « Expédiée »
                    │                           │ événement « paiement terminé »           ▼
                    │                           ▼                               n8n « Statut commande »
                    │                 n8n « Confirmation paiement »                        │
                    │                    ├─▶ email de confirmation (Gmail)                 ├─▶ email « en route »
                    │                    └─▶ enregistre la commande ─▶ PostgreSQL (Neon) ◀─┘
                    │
   contact.html ────┴──▶ Web3Forms ──▶ email dans ma boîte Gmail
```

**Idée clé :** le site n'a pas de serveur à lui. Tout ce qui demande un serveur (paiement, emails, écriture en base) est délégué à des services : n8n, Stripe, Neon et Web3Forms.

---

## 3. Les briques, une par une

### 3.1 Le site (front-end)
- **Quoi :** pages HTML, un seul fichier CSS (`styles.css`), du JavaScript « vanilla » (sans framework). Les pages de l'espace client utilisent des **modules ES** (`js/*.js`, avec `import` / `export`).
- **Panier :** stocké dans le **localStorage** du navigateur (clé `auraCart`). Il survit au rechargement, et aucun serveur n'est nécessaire.
- **Hébergement :** GitHub Pages. Chaque `git push` sur `main` republie le site automatiquement (une petite minute, plus le cache jusqu'à 10 minutes).
- **Pourquoi pas React :** le site est petit. Le JavaScript pur montre que je comprends ce que font les frameworks à ma place (manipuler le DOM, écouter les événements, appeler une API avec `fetch`).

### 3.2 Le paiement : Stripe + n8n
*(Détail nœud par nœud : section 4.3.)*

1. Sur `checkout.html`, le bouton « Payer » envoie le panier en **JSON** à un **webhook** n8n (`/webhook/aura-checkout`). Il n'envoie **que l'identifiant des produits et la quantité, jamais le prix**.
2. Le workflow n8n **« Créer session Stripe Checkout »** vérifie le panier, lit le nom et le prix de chaque produit **dans la table `products` de la base**, refuse un produit inconnu, désactivé ou une quantité invalide, puis demande à Stripe une page de paiement et renvoie son adresse.
3. Le navigateur est redirigé vers Stripe. On paie avec une carte de test (`4242 4242 4242 4242`).
4. Stripe renvoie vers `checkout-success.html`, qui vide le panier.

**Pourquoi passer par n8n ?** Pour créer une session Stripe, il faut la **clé secrète** Stripe. Elle ne doit jamais être dans le navigateur, où n'importe qui peut lire le code. n8n la garde côté serveur.

**Pourquoi le prix est fixé par n8n et pas par le navigateur ?** Tout ce qui vient du navigateur peut être modifié par l'utilisateur (outils de développement, requête faite à la main). Au début, le prix venait du navigateur. Je l'ai corrigé, puis testé : une requête qui annonce « L'Ombre à 0,50 € » crée quand même un paiement de 350 € chez Stripe. Les adresses de retour après paiement sont aussi limitées à mon site, pour qu'on ne puisse pas rediriger un client vers un autre site.
**Une seule source de vérité :** les produits sont dans la table `app.products`. La boutique les affiche depuis la base, et n8n y lit les prix. Si je change un prix dans la base, l'affichage et le paiement suivent ensemble. J'ai vérifié en passant Horizon à 291 € : Stripe a demandé 291 €. *Histoire à raconter :* au départ, la liste des produits était écrite en dur dans `script.js` (données fictives de la première version), et le prix était envoyé par le navigateur. En ajoutant le vrai paiement, j'ai repéré la faille, corrigé, puis déplacé le catalogue en base.

### 3.3 Après le paiement : workflow « Confirmation paiement »
*(Détail nœud par nœud : section 4.4.)*

Il démarre quand Stripe envoie l'événement `checkout.session.completed`. Deux branches indépendantes :
- **Email de confirmation** au client, via Gmail. Le nom du client est **échappé** pour éviter l'injection de HTML dans l'email.
- **Enregistrement en base :**
  1. n8n **redemande la session à Stripe** pour vérifier que `payment_status = paid`, au lieu de faire confiance aveuglément au message reçu ;
  2. il récupère les articles achetés ;
  3. il insère la commande et ses lignes dans PostgreSQL ;
  4. si ça échoue, il m'envoie une alerte par email.
- **Idempotence :** si Stripe renvoie deux fois le même événement (ça arrive), la commande n'est pas créée en double. La colonne `stripe_session_id` est **unique**, et la requête utilise `on conflict do nothing`.

### 3.4 La base de données : PostgreSQL chez Neon
Tables dans le schéma `app` :
| Table | Contenu |
|---|---|
| `orders` | une commande : numéro `AUR-1001`…, email, total, statut, numéro de suivi, dates, `stripe_session_id` |
| `order_items` | les lignes d'une commande : produit, prix unitaire, quantité (liée à `orders` par une **clé étrangère**) |
| `admins` | qui est administrateur (mon compte) |
| `products` | le catalogue : nom, prix, catégorie, image, `active` (un produit désactivé disparaît de la boutique et ne peut plus être payé) |
| `admin_kpis` | une **vue** qui calcule le chiffre d'affaires, le nombre de commandes, les commandes à expédier et le produit le plus vendu |

Règles écrites **dans la base** (fichier `db/migrations/001_orders.sql`) :
- **Statuts :** `payee` → `expediee` → `livree`. Un **trigger** interdit de revenir en arrière et génère le numéro de suivi `FR-AURA-xxxxx` au passage en « Expédiée ».
- **Email normalisé :** un autre trigger met l'email en minuscules et retire les espaces. `Camille@Exemple.fr ` et `camille@exemple.fr`, c'est donc la même personne.
- **Migrations :** chaque changement de structure est un fichier SQL numéroté (`001_…`, `002_…`). On sait exactement dans quel ordre la base a été construite.

### 3.5 Comptes et sécurité : Neon Auth + RLS
- **Neon Auth** gère les comptes (inscription, connexion, mot de passe). À l'inscription, un **code à 6 chiffres** est envoyé par email pour prouver que l'adresse appartient bien à l'utilisateur.
- Une fois connecté, le navigateur a un **JWT**, un jeton signé qui dit « je suis l'utilisateur X ».
- Le navigateur lit les commandes directement via la **Neon Data API**, en joignant ce JWT.
- **La RLS (Row-Level Security)** est le cœur de la sécurité. C'est PostgreSQL lui-même qui filtre les lignes selon qui demande :
  - un acheteur ne voit que les commandes dont l'email = **son email vérifié** ;
  - l'admin voit tout, mais ne peut modifier que le statut et le numéro de suivi ;
  - **personne ne peut créer ni supprimer** une commande depuis le navigateur. Seul n8n insère, avec sa propre connexion serveur ;
  - sans être connecté, on ne voit aucune commande. Un visiteur reçoit un **jeton anonyme** de Neon Auth qui lui permet seulement de lire les produits actifs.

**Pourquoi c'est important :** même si quelqu'un modifie le JavaScript de la page ou appelle l'API à la main, la base refuse. La sécurité ne dépend pas du front-end.

**Analogie simple :** la RLS, c'est un guichetier qui regarde ta carte d'identité (le JWT) avant de te donner un dossier, et qui ne te tend que les tiens.

### 3.6 L'espace client et le back-office
- `compte.html` : connexion, création de compte, saisie du code de vérification. Après connexion, un admin est envoyé vers `admin.html`, les autres vers `mes-commandes.html`.
- `mes-commandes.html` : les commandes de l'acheteur avec une frise Payée → Expédiée → Livrée. Une commande passée **sans compte** apparaît quand on crée un compte avec le même email.
- `admin.html` : 4 indicateurs (la vue `admin_kpis`) et le tableau des commandes avec changement de statut.

### 3.7 Workflow « Statut commande » (email « en route »)
*(Détail nœud par nœud : section 4.5.)*

Quand l'admin passe une commande à « Expédiée », `admin.html` appelle le webhook n8n `aura-order-status` avec son JWT.
1. n8n **vérifie que l'appelant est admin** en demandant à la Data API (`rpc/admin_scope`) avec ce jeton. Sinon : réponse **401** (refusé).
2. **Garde anti-doublon :** une seule requête SQL marque « email envoyé » *seulement si* la commande est expédiée *et* que l'email n'est pas déjà parti. Un double clic n'envoie donc qu'un seul email.
3. Il envoie l'email « Votre commande est en route ». Si Gmail échoue, il **annule le marquage** pour qu'on puisse réessayer.

### 3.8 Formulaire de contact : Web3Forms
- `contact.html` + `js/contact.js` envoient les champs à Web3Forms avec `fetch`. Web3Forms me les transfère par email. « Répondre » répond directement au visiteur.
- La clé Web3Forms est **publique par conception** : elle permet seulement d'envoyer des messages vers *ma* boîte.
- Un champ caché (`botcheck`) piège les robots de spam. Les humains ne le voient pas, les robots le remplissent.
- **Choix assumé :** un service simple plutôt qu'un workflow n8n de plus à maintenir.

---

## 4. Les automatisations n8n en détail

### 4.1 n8n en 2 minutes
**n8n** est un outil d'automatisation : on construit des **workflows** en reliant des blocs (**nœuds**) dans une interface visuelle. Le mien est **auto-hébergé** sur un serveur (VPS), accessible en HTTPS sur `https://n8n.212.227.12.49.nip.io`. `nip.io` est un service DNS gratuit qui transforme une adresse IP en nom de domaine, ce qui permet d'avoir un certificat HTTPS (Let's Encrypt) sans acheter de domaine.

Le vocabulaire à connaître :

| Terme n8n | Ce que c'est |
|---|---|
| **Workflow** | Un scénario automatique : un déclencheur, puis une suite d'actions. |
| **Trigger (déclencheur)** | Le premier nœud, qui lance le workflow : un **Webhook** (appel HTTP), un événement **Stripe**, une heure fixe… |
| **Nœud** | Une étape : appel HTTP, requête SQL, envoi Gmail, condition **If**, code JavaScript… |
| **Item** | Une donnée JSON qui passe d'un nœud au suivant. Chaque nœud reçoit les items du précédent et en produit de nouveaux. |
| **Expression** `{{ }}` | Un petit bout de JavaScript dans un champ, pour utiliser une donnée : `{{ $json.email }}` (l'item courant) ou `{{ $('Valider Panier').first().json.items }}` (un nœud précédent). |
| **Credential** | Un identifiant secret (clé Stripe, compte Gmail, connexion à la base) stocké **chiffré** dans n8n. Les nœuds l'utilisent sans jamais l'afficher. |
| **Execution** | Une exécution du workflow. n8n garde l'historique : on voit les données entrées et sorties de **chaque** nœud. C'est l'outil n°1 pour dépanner. |
| **Actif / inactif** | Un workflow doit être **actif** pour réagir aux vrais événements (URL de *production*). En mode édition, on utilise l'URL de *test*. |
| **Sortie d'erreur** | Option d'un nœud (« On Error → Continue (using error output) ») : au lieu d'arrêter le workflow en cas d'échec, il envoie l'erreur vers une branche dédiée (alerte, réponse d'erreur…). |
| **Respond to Webhook** | Le nœud qui choisit **quoi répondre** à l'appelant du webhook (contenu JSON + code HTTP 200, 401, 502…). |

### 4.2 Les trois workflows d'AURA

| Workflow | Déclencheur | Rôle | Export dans le projet |
|---|---|---|---|
| **Créer session Stripe Checkout** | Webhook `POST /webhook/aura-checkout` (appelé par `checkout.html`) | Transformer le panier en page de paiement Stripe, **avec les prix de la base** | `n8n/aura-creer-session-stripe.json` |
| **Confirmation paiement Stripe** | Événement Stripe `checkout.session.completed` | Envoyer l'email de confirmation et **enregistrer la commande** en base | `n8n/aura-confirmation-paiement.json` |
| **Statut commande** | Webhook `POST /webhook/aura-order-status` (appelé par `admin.html`) | Envoyer l'email « Votre commande est en route », **une seule fois** et **seulement pour un admin** | `n8n/aura-statut-commande.json` |

Les fichiers `.json` sont des **exports** : on peut les réimporter dans un autre n8n (*Import from file*). Les credentials ne sont pas inclus, il faut les recréer.

### 4.3 Workflow « Créer session Stripe Checkout »
```
Réception Panier ─▶ Valider Panier ─▶ Lire Prix (Neon) ─▶ Construire Requête Stripe ─▶ Créer Session Stripe ─▶ Répondre avec URL Paiement
   (Webhook)          (Code)            (Postgres)            (Code)                     (HTTP Request)          (Respond to Webhook)
```

| Nœud | Ce qu'il fait |
|---|---|
| **Réception Panier** | Reçoit le JSON envoyé par la page : `{ items: [{ id: 2, quantity: 1 }], email, successUrl, cancelUrl }`. |
| **Valider Panier** | Vérifie la forme : 1 à 20 articles, `id` entier, quantité de 1 à 10. **N'accepte comme adresses de retour que mon site ou localhost** (sinon il met celles du site). Valide l'email. Lève une erreur si le panier est invalide. |
| **Lire Prix (Neon)** | Requête SQL : `select id, name, price from app.products where active and id in (…)`. Les identifiants sont passés en **paramètre** (`$1`), jamais collés dans le texte SQL : pas d'**injection SQL** possible. Option *Always Output Data* activée pour continuer même si aucun produit n'est trouvé. |
| **Construire Requête Stripe** | Pour chaque article, prend **le nom et le prix de la base** et construit le corps de la requête Stripe (`line_items`, montants en centimes). Produit inconnu ou désactivé : erreur, pas de session. |
| **Créer Session Stripe** | `POST https://api.stripe.com/v1/checkout/sessions` avec la **clé secrète Stripe** (credential). Stripe répond avec l'adresse de la page de paiement. |
| **Répondre avec URL Paiement** | Renvoie `{ checkoutUrl, sessionId }` à la page, qui redirige le client vers Stripe. |

**Ce qui le rend sûr :** le navigateur ne décide ni du prix, ni du nom, ni de l'adresse de retour. Testé : une requête « L'Ombre à 0,50 € » donne bien un paiement de 350 € chez Stripe.
**En cas d'erreur** (panier invalide), aucune session n'est créée. Le webhook renvoie une réponse vide et la page affiche « Une erreur est survenue… ».

### 4.4 Workflow « Confirmation paiement Stripe »
```
                          ┌─▶ Extraire Infos Commande ─▶ Envoyer Email Confirmation (Gmail)
Paiement Reçu (Stripe) ───┤
                          └─▶ Vérifier Session (Stripe) ─▶ Paiement confirmé ? ─oui─▶ Récupérer Articles (Stripe) ─▶ Enregistrer Commande (Neon)
                                      │ erreur                                           │ erreur                       │ erreur
                                      └──────────────▶ Alerte commande non enregistrée (Gmail, vers moi) ◀──────────────┘
```

| Nœud | Ce qu'il fait |
|---|---|
| **Paiement Reçu (Stripe)** | Déclencheur *Stripe Trigger* sur `checkout.session.completed`. À l'activation, n8n s'abonne lui-même à cet événement chez Stripe. |
| **Extraire Infos Commande** | Nœud *Set* : garde seulement l'email, le nom, le montant (centimes → euros) et la devise. Le **nom est échappé** (`<` devient `&lt;`…) pour qu'un nom piégé ne puisse pas injecter de HTML dans l'email. |
| **Envoyer Email Confirmation** | Gmail : email HTML aux couleurs d'AURA (« Merci pour votre commande… »). |
| **Vérifier Session (Stripe)** | Relit la session **directement chez Stripe** avec la clé secrète, au lieu de croire le message reçu. |
| **Paiement confirmé ?** | Condition *If* : continue seulement si `payment_status = paid`. |
| **Récupérer Articles (Stripe)** | Demande à Stripe la liste des articles payés (nom, quantité, montant). |
| **Enregistrer Commande (Neon)** | **Une seule requête SQL** qui insère la commande puis ses lignes. `on conflict (stripe_session_id) do nothing` : si Stripe renvoie le même événement, rien n'est créé en double (**idempotence**). Le numéro `AUR-xxxx` est généré par la base. |
| **Alerte commande non enregistrée** | Si une des étapes de la branche base échoue (sortie d'erreur), m'envoie un email avec l'étape en échec, la session Stripe et l'erreur. Une commande payée n'est donc jamais perdue en silence. |

**Pourquoi deux branches ?** Si la base est en panne, le client reçoit quand même sa confirmation, et moi une alerte. Une panne d'un côté ne bloque pas l'autre.
**Limite connue :** la branche email part directement du message reçu, sans la revérification chez Stripe. Amélioration possible : n'envoyer l'email qu'après « Paiement confirmé ? ».

### 4.5 Workflow « Statut commande »
```
Webhook ─▶ Vérifier admin (Neon) ─▶ Admin ? ─oui─▶ Valider orderId ─▶ orderId valide ? ─oui─▶ Marquer email envoyé (Neon) ─▶ Préparer email ─▶ Email à envoyer ? ─oui─▶ Envoyer Email Expédition ─▶ Répondre envoyé (200)
              │ erreur             │ non                                  │ non                         │ erreur                                       │ non                           │ erreur
              └────────────────────┴─▶ Répondre refusé (401)              └─────────────────────────────┴─────────▶ Répondre non envoyé (200) ◀─────────┘                               └─▶ Annuler marquage (Neon) ─▶ Répondre échec email (502)
```

| Nœud | Ce qu'il fait |
|---|---|
| **Commande expédiée (Webhook)** | Reçoit `{ orderId }` depuis `admin.html`, avec l'en-tête `Authorization: Bearer <JWT>`. N'accepte que les appels venant de mon site ou de localhost (**CORS**, option *Allowed Origins*). |
| **Vérifier admin (Neon)** | Transmet le JWT à la Data API Neon (`rpc/admin_scope`). C'est **la base** qui dit si ce jeton appartient à un admin. n8n ne décode pas le jeton lui-même : pas de clé à gérer. |
| **Admin ?** | Si la réponse n'est pas `all` : **401 refusé**. |
| **Valider orderId** | Code : `orderId` doit être un entier positif. Tout le reste est rejeté. |
| **Marquer email envoyé (Neon)** | La **garde atomique** : `update … set shipped_email_sent_at = now() where id = $1 and status = 'expediee' and shipped_email_sent_at is null`. Une seule requête peut réussir. Deux clics simultanés : un seul obtient la ligne, l'autre n'obtient rien. |
| **Préparer email** | Code : construit l'email HTML (articles, total, numéro de suivi), en **échappant** toutes les valeurs. Si la garde n'a rien renvoyé : rien à envoyer. |
| **Envoyer Email Expédition** | Gmail : « Votre commande AURA est en route ». |
| **Annuler marquage (Neon)** | Si Gmail échoue : remet `shipped_email_sent_at` à vide (seulement si c'est toujours notre marque), pour pouvoir **réessayer**. C'est une **compensation**. |
| **Répondre …** | `sent: true` (200), `sent: false` (200, rien à envoyer), **401** (pas admin), **502** (Gmail en échec). `admin.html` affiche le bon message selon la réponse. |

### 4.6 Les bonnes pratiques à citer (et où elles sont)

| Principe | Exemple dans AURA |
|---|---|
| **Ne jamais faire confiance au navigateur** | Prix lus en base (checkout), admin vérifié par la base (statut). |
| **Revérifier à la source** | La confirmation relit la session chez Stripe avant d'enregistrer. |
| **Idempotence** | `on conflict do nothing` sur `stripe_session_id`. |
| **Garde atomique** | Un seul email « en route », même en cas de double clic. |
| **Compensation** | « Annuler marquage » si l'email échoue. |
| **Requêtes paramétrées** | `$1`, `$2` dans les nœuds Postgres : pas d'injection SQL. |
| **Échappement HTML** | Noms et articles échappés dans les emails. |
| **Secrets dans les credentials** | Aucune clé dans le code du site ni dans les exports. |
| **Alerter plutôt que perdre** | Email d'alerte si une commande payée n'est pas enregistrée. |
| **Réponses explicites** | Codes 200 / 401 / 502 : la page sait quoi afficher. |

### 4.7 Montrer n8n pendant l'entretien
1. Ouvrir la liste des workflows : les trois « AURA — … » sont **actifs**.
2. Ouvrir « Statut commande » : suivre le chemin du webhook à la réponse, et montrer les branches 401 / 502.
3. Faire une action sur le site (expédier une commande), puis ouvrir **Executions** : cliquer sur l'exécution et montrer les données qui sortent de chaque nœud.
4. Montrer une **sortie d'erreur** (la branche « Alerte » du workflow Confirmation) en expliquant pourquoi elle existe.
5. Montrer l'écran **Credentials** sans ouvrir les secrets : « les clés sont ici, chiffrées, jamais dans le code ».

### 4.8 Dépanner (et le raconter)

| Symptôme | Cause | Solution |
|---|---|---|
| Les emails ne partent plus, erreur `invalid_grant` | Jeton Gmail expiré. Mon application Google était en mode « Test » (jetons valables 7 jours). | Application publiée « En production », puis credential Gmail reconnecté une fois. |
| Erreur `42703` (colonne inconnue) après un changement en base | La Data API Neon garde l'ancienne liste de colonnes en cache. | Ré-enregistrer les schémas exposés (`db_schemas`). |
| Le paiement ne s'ouvre pas | Panier invalide (produit désactivé…) ou n8n injoignable. | **Executions** → ouvrir l'exécution en rouge → lire l'erreur du nœud. |
| Une exécution a échoué pour une raison passagère | Réseau, service momentanément indisponible. | Bouton **Retry** sur l'exécution. |

### 4.9 Questions sur n8n
**Q : Pourquoi n8n plutôt que Zapier ou Make ?**
R : n8n est **auto-hébergeable** : mes données et mes clés restent sur mon serveur, sans limite d'exécutions payante. Il permet aussi du vrai code (nœud *Code*) et du SQL quand le visuel ne suffit pas.

**Q : Comment Stripe prévient-il n8n ?**
R : Par un **webhook** : quand le paiement est terminé, Stripe envoie une requête HTTP à n8n. Le nœud *Stripe Trigger* s'abonne lui-même à l'événement quand j'active le workflow.

**Q : Qu'est-ce qui empêche quelqu'un d'appeler tes webhooks ?**
R : Rien n'empêche de les *appeler*, l'adresse est publique. Mais ils ne font **confiance à rien** de ce qu'ils reçoivent : le checkout prend ses prix en base, la confirmation revérifie le paiement chez Stripe avant d'enregistrer, et le statut exige un JWT d'admin vérifié par la base.

**Q : Que se passe-t-il si Gmail tombe en panne pendant l'email « en route » ?**
R : La sortie d'erreur du nœud Gmail déclenche « Annuler marquage » : la commande redevient « email non envoyé », et la page admin reçoit un **502**. On peut réessayer, et il n'y aura toujours qu'un seul email.

**Q : Comment tu passes des données d'un nœud à un autre ?**
R : Chaque nœud reçoit les items JSON du précédent (`$json`). Pour un nœud plus ancien, j'utilise une expression comme `$('Valider Panier').first().json`.

**Q : Pourquoi certains nœuds sont du code et pas des nœuds visuels ?**
R : Pour les validations précises (formats, limites) et la construction de l'email HTML, le code est plus court et plus lisible qu'une dizaine de nœuds *If* / *Set*. Le reste (Stripe, Gmail, Postgres, réponses) utilise les nœuds natifs.

**Q : Comment tu testes un workflow ?**
R : En mode édition avec l'URL de test et des données d'exemple, puis en vrai : des requêtes volontairement fausses (prix trafiqué, produit inconnu, appel sans être admin), en vérifiant le résultat dans **Executions**.

**Q : Comment tu sauvegardes tes workflows ?**
R : Ils sont exportés en JSON dans le dossier `n8n/` du projet, versionnés avec git. Les credentials ne sont pas dans les exports.

---

## 5. La démo à faire en entretien (5 minutes)

1. **Boutique :** ajouter une paire au panier, recharger la page (le panier est toujours là grâce au localStorage).
2. **Paiement :** payer avec la carte test `4242 4242 4242 4242`, n'importe quelle date future, n'importe quel CVC.
3. **Email :** montrer l'email de confirmation reçu.
4. **Espace client :** se connecter, la commande apparaît avec la frise.
5. **Back-office :** se connecter en admin, montrer les indicateurs, passer la commande à « Expédiée ».
6. **Email « en route » :** montrer qu'il arrive, avec le numéro de suivi.
7. **n8n :** ouvrir l'onglet *Executions* et montrer le parcours de chaque nœud. C'est très visuel.
8. **Contact :** faire envoyer un message par le recruteur depuis son téléphone. Il arrive dans ma boîte en quelques secondes.

**Avant l'entretien, vérifier :**
- que le credential Gmail de n8n n'a pas expiré (n8n → Credentials → Gmail account → *Reconnect* si besoin) ;
- que le serveur n8n répond ;
- faire une commande de test la veille.

---

## 6. Comment j'ai travaillé avec l'IA (Claude Code)

À dire franchement : les recruteurs apprécient l'honnêteté, et savoir **piloter** une IA est une compétence recherchée.

**Méthode suivie :**
1. **Cadrage** : j'explique ce que je veux, l'IA me pose des questions, et **je décide** (par exemple : garder Gmail plutôt que SMTP, retirer le mode démo, utiliser Web3Forms pour le contact).
2. **Spécification écrite** : `docs/superpowers/specs/2026-10-29-espace-client-design.md` décrit le besoin, les règles et ce qui est hors sujet.
3. **Plan découpé en tâches** : `docs/superpowers/plans/2026-10-29-espace-client.md`, avec des cases à cocher et pour chaque tâche les fichiers concernés et les tests attendus.
4. **Réalisation tâche par tâche**, chaque tâche **relue** (revue de code) avant de passer à la suivante, avec un commit par étape. L'historique `git log` montre la progression.
5. **Tests automatiques** (`npm test`, 24 tests) qui vérifient surtout les règles de sécurité de la base.
6. **Vérification réelle** : paiements test, emails reçus, essais dans le navigateur.

**Ce que je peux dire :** « L'IA a écrit une grande partie du code, mais j'ai fait les choix d'architecture et de sécurité. J'ai relu, testé et validé chaque étape, et je sais expliquer chaque brique. Quand quelque chose ne marchait pas, on a cherché la cause ensemble au lieu de corriger au hasard. »

**Point de vigilance :** ne pas prétendre avoir tout écrit à la main. Si on te montre une ligne que tu ne comprends pas, dis-le et explique comment tu ferais pour la comprendre (lire la doc, la tester).

---

## 7. Les tests

- `npm test` lance `node --test` sur deux fichiers (24 tests) :
  - `tests/orders-format.test.mjs` : mise en forme (prix en euros, dates, frise des statuts) ;
  - `tests/rls.test.mjs` : **les règles de sécurité contre la vraie base**, avec des comptes de test. Par exemple : « un inconnu ne voit rien », « un email non vérifié ne voit rien », « l'acheteur ne peut pas changer un statut », « un statut ne peut pas revenir en arrière », « personne ne peut insérer ni supprimer depuis le navigateur ».
- **Pourquoi tester la RLS ?** C'est la partie où une erreur serait grave : un client verrait les commandes des autres. Un test le prouve à chaque fois.
- Les mots de passe et la connexion à la base sont dans `tests/.env`, **qui n'est pas sur GitHub**.

---

## 8. Limites connues et améliorations possibles

Les citer toi-même montre du recul.
- **Gestion du catalogue** : pour changer un prix ou ajouter un produit, je passe par la console Neon. Il n'y a pas encore d'écran dans le back-office pour ça.
- **Paiements asynchrones** (Klarna, virement…) : l'événement `async_payment_succeeded` n'est pas géré.
- **Email de confirmation** : il part directement du message Stripe reçu, sans la revérification faite pour l'enregistrement en base. À améliorer : l'envoyer après « Paiement confirmé ? ».
- **Gmail OAuth** : le jeton expirait tous les 7 jours (application Google en mode « Test »). C'est corrigé en publiant l'application. En vraie production, je passerais quand même par un service d'emailing transactionnel (Brevo, Resend…).
- **n8n sur un VPS avec une adresse `nip.io`** : pratique pour un projet, mais en vrai il faudrait un nom de domaine, des sauvegardes et de la supervision.
- **Cookies tiers** : la connexion n'a pas été testée sur Safari ni en navigation privée.
- Pas de framework ni d'étape de build : simple, mais moins adapté si le site grossit.

---

## 9. Questions probables et réponses

**Q : Pourquoi un site statique et pas un back-end Node/PHP ?**
R : Le site lui-même n'a besoin de rien calculer. Les parties qui demandent un serveur (secret Stripe, emails, écriture en base) sont dans n8n. C'est gratuit à héberger et simple à déployer.

**Q : C'est quoi un webhook ?**
R : Une adresse web qu'un service appelle pour prévenir qu'il s'est passé quelque chose. Stripe appelle mon webhook n8n quand un paiement est terminé. Moi, j'appelle un webhook n8n depuis la page admin quand j'expédie.

**Q : Comment tu empêches un client de voir les commandes des autres ?**
R : Avec la RLS de PostgreSQL. La base lit le JWT du client et ne renvoie que les commandes dont l'email correspond à son email vérifié. C'est testé automatiquement.

**Q : C'est quoi un JWT ?**
R : Un jeton signé, délivré à la connexion, qui contient l'identité de l'utilisateur. Le serveur vérifie la signature, donc on ne peut pas le falsifier. Il est envoyé dans l'en-tête `Authorization: Bearer …`.

**Q : Pourquoi l'email doit être « vérifié » ?**
R : Sinon, n'importe qui pourrait créer un compte avec l'email de quelqu'un d'autre et voir ses commandes. Le code à 6 chiffres prouve qu'on possède la boîte.

**Q : Que se passe-t-il si Stripe envoie deux fois le même événement ?**
R : Rien de grave : `stripe_session_id` est unique et l'insertion utilise `on conflict do nothing`. C'est ce qu'on appelle l'**idempotence**.

**Q : Et si l'admin clique deux fois sur « Expédiée » ?**
R : Un seul email part. Une requête SQL marque l'envoi seulement si ce n'est pas déjà fait, et c'est atomique : deux appels simultanés ne peuvent pas passer tous les deux.

**Q : Où sont stockés les secrets ?**
R : Jamais dans le code. Les clés Stripe, Gmail et la connexion à la base sont dans les *credentials* de n8n, et les données de test dans `tests/.env`, ignoré par git. Le code ne contient que des adresses publiques et la clé Web3Forms, qui est publique par conception.

**Q : Pourquoi n8n et pas du code ?**
R : C'est rapide à construire et c'est visuel : on voit chaque exécution et où elle a échoué. Pour des intégrations entre services (Stripe, Gmail, base), c'est adapté. Pour de la logique lourde, j'écrirais du code.

**Q : Pourquoi PostgreSQL et pas MongoDB ?**
R : Les données sont relationnelles (une commande a plusieurs lignes) et j'avais besoin de la RLS, des contraintes et des triggers que PostgreSQL fournit.

**Q : C'est quoi une clé étrangère ? Un index ? Un trigger ?**
R : *Clé étrangère* : `order_items.order_id` doit pointer vers une commande qui existe ; si on supprime la commande, ses lignes partent avec (`on delete cascade`). *Index* : accélère les recherches, par exemple sur l'email. *Trigger* : une fonction lancée automatiquement avant ou après une modification, ici pour interdire un retour de statut et générer le numéro de suivi.

**Q : Comment tu déploies ?**
R : `git push` sur la branche `main`. GitHub Pages republie automatiquement. Je travaille sur une branche (`feature/espace-client`) et je fusionne quand c'est testé.

**Q : Un client peut-il modifier le prix avant de payer ?**
R : Non. Le navigateur n'envoie que l'identifiant du produit et la quantité. C'est n8n qui lit le prix dans la base. Je l'ai vérifié en envoyant exprès un faux prix : Stripe a quand même reçu le vrai montant. C'est la règle de base : ne jamais faire confiance à ce qui vient du navigateur.

**Q : Qu'est-ce que tu améliorerais en premier ?**
R : Un écran de gestion des produits dans le back-office, gérer les paiements asynchrones, et remplacer Gmail par un service d'emails transactionnels.

**Q : Comment un visiteur non connecté peut-il lire les produits si la base exige un jeton ?**
R : Neon Auth délivre un **jeton anonyme** (rôle `anonymous`). En base, ce rôle a seulement le droit de lire les produits actifs (`grant select` + une règle RLS). Il ne peut rien lire d'autre et rien modifier. C'est testé.

**Q : Quelle a été la plus grosse difficulté ?**
R : Exemples réels : rendre la sécurité indépendante du navigateur (RLS + vérification de l'admin dans n8n) ; le cache de la Data API Neon après un changement de colonnes (erreur `42703`, il faut ré-enregistrer les schémas) ; le jeton Gmail qui expire.

---

## 10. Glossaire

| Terme | En une phrase |
|---|---|
| **API** | Une « porte » qu'un programme expose pour que d'autres lui parlent (demander, envoyer des données). |
| **fetch** | La fonction JavaScript qui envoie une requête HTTP depuis la page. |
| **JSON** | Format texte pour échanger des données : `{ "email": "a@b.fr" }`. |
| **localStorage** | Petit espace de stockage dans le navigateur, propre à chaque site. |
| **Module ES** | Fichier JS qui partage du code avec `export` et en récupère avec `import`. |
| **Webhook** | Adresse web appelée automatiquement par un service quand un événement se produit. |
| **Workflow n8n** | Une suite de nœuds (déclencheur → actions) qui s'exécute automatiquement. |
| **Credential** | Identifiant secret stocké dans n8n (clé Stripe, compte Gmail, base…). |
| **JWT** | Jeton signé qui prouve qui est l'utilisateur connecté. |
| **RLS** | Row-Level Security : la base filtre les lignes selon qui fait la demande. |
| **Migration** | Fichier SQL numéroté qui modifie la structure de la base, appliqué dans l'ordre. |
| **Trigger** | Fonction exécutée automatiquement par la base lors d'une insertion ou modification. |
| **Vue** | Une requête enregistrée qu'on interroge comme une table (ici, les KPIs). |
| **Clé étrangère** | Colonne qui doit pointer vers une ligne existante d'une autre table. |
| **Idempotence** | Faire deux fois la même opération donne le même résultat qu'une seule fois. |
| **Échapper (HTML)** | Transformer `<` en `&lt;` pour qu'un texte saisi ne soit pas interprété comme du code. |
| **CORS** | Règle du navigateur : une page ne peut appeler un autre domaine que si ce domaine l'autorise. |
| **401** | Code HTTP « non autorisé ». **403** : interdit. **404** : introuvable. **200** : OK. |
| **Mode test Stripe** | Environnement où aucun argent réel ne circule ; cartes de test fournies par Stripe. |

---

## 11. Où regarder dans le projet

| Je veux montrer… | Fichier |
|---|---|
| L'état du projet | `PROJET-AURA.md` |
| La structure de la base et les règles de sécurité | `db/migrations/001_orders.sql`, `002_drop_demo.sql`, `003_products.sql` |
| La connexion et l'appel à la base depuis le site | `js/neon-client.js` |
| Le back-office | `admin.html`, `js/admin.js` |
| Le formulaire de contact | `contact.html`, `js/contact.js` |
| Les workflows n8n (exports) | `n8n/aura-creer-session-stripe.json`, `n8n/aura-confirmation-paiement.json`, `n8n/aura-statut-commande.json` |
| Les tests de sécurité | `tests/rls.test.mjs` |
| La méthode de travail | `docs/superpowers/specs/…`, `docs/superpowers/plans/…`, `git log --oneline` |
