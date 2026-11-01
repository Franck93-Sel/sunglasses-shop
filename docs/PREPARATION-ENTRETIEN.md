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
1. Sur `checkout.html`, le bouton « Payer » envoie le panier en **JSON** à un **webhook** n8n (`/webhook/aura-checkout`). Il n'envoie **que l'identifiant des produits et la quantité, jamais le prix**.
2. Le workflow n8n **« Créer session Stripe Checkout »** retrouve chaque produit dans **son propre catalogue** (nom et prix), refuse un produit inconnu ou une quantité invalide, puis demande à Stripe une page de paiement et renvoie son adresse.
3. Le navigateur est redirigé vers Stripe. On paie avec une carte de test (`4242 4242 4242 4242`).
4. Stripe renvoie vers `checkout-success.html`, qui vide le panier.

**Pourquoi passer par n8n ?** Pour créer une session Stripe, il faut la **clé secrète** Stripe. Elle ne doit jamais être dans le navigateur, où n'importe qui peut lire le code. n8n la garde côté serveur.

**Pourquoi le prix est fixé par n8n et pas par le navigateur ?** Tout ce qui vient du navigateur peut être modifié par l'utilisateur (outils de développement, requête faite à la main). Au début, le prix venait du navigateur. Je l'ai corrigé, puis testé : une requête qui annonce « L'Ombre à 0,50 € » crée quand même un paiement de 350 € chez Stripe. Les adresses de retour après paiement sont aussi limitées à mon site, pour qu'on ne puisse pas rediriger un client vers un autre site.
*Contrepartie :* la liste des produits existe à deux endroits (`script.js` pour l'affichage, le workflow n8n pour les prix). Si j'ajoute un produit, il faut l'ajouter aux deux. L'étape suivante serait une table `products` en base, lue par les deux.

### 3.3 Après le paiement : workflow « Confirmation paiement »
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
  - sans être connecté, on ne voit rien.

**Pourquoi c'est important :** même si quelqu'un modifie le JavaScript de la page ou appelle l'API à la main, la base refuse. La sécurité ne dépend pas du front-end.

**Analogie simple :** la RLS, c'est un guichetier qui regarde ta carte d'identité (le JWT) avant de te donner un dossier, et qui ne te tend que les tiens.

### 3.6 L'espace client et le back-office
- `compte.html` : connexion, création de compte, saisie du code de vérification. Après connexion, un admin est envoyé vers `admin.html`, les autres vers `mes-commandes.html`.
- `mes-commandes.html` : les commandes de l'acheteur avec une frise Payée → Expédiée → Livrée. Une commande passée **sans compte** apparaît quand on crée un compte avec le même email.
- `admin.html` : 4 indicateurs (la vue `admin_kpis`) et le tableau des commandes avec changement de statut.

### 3.7 Workflow « Statut commande » (email « en route »)
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

## 4. La démo à faire en entretien (5 minutes)

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

## 5. Comment j'ai travaillé avec l'IA (Claude Code)

À dire franchement : les recruteurs apprécient l'honnêteté, et savoir **piloter** une IA est une compétence recherchée.

**Méthode suivie :**
1. **Cadrage** : j'explique ce que je veux, l'IA me pose des questions, et **je décide** (par exemple : garder Gmail plutôt que SMTP, retirer le mode démo, utiliser Web3Forms pour le contact).
2. **Spécification écrite** : `docs/superpowers/specs/2026-10-29-espace-client-design.md` décrit le besoin, les règles et ce qui est hors sujet.
3. **Plan découpé en tâches** : `docs/superpowers/plans/2026-10-29-espace-client.md`, avec des cases à cocher et pour chaque tâche les fichiers concernés et les tests attendus.
4. **Réalisation tâche par tâche**, chaque tâche **relue** (revue de code) avant de passer à la suivante, avec un commit par étape. L'historique `git log` montre la progression.
5. **Tests automatiques** (`npm test`, 20 tests) qui vérifient surtout les règles de sécurité de la base.
6. **Vérification réelle** : paiements test, emails reçus, essais dans le navigateur.

**Ce que je peux dire :** « L'IA a écrit une grande partie du code, mais j'ai fait les choix d'architecture et de sécurité. J'ai relu, testé et validé chaque étape, et je sais expliquer chaque brique. Quand quelque chose ne marchait pas, on a cherché la cause ensemble au lieu de corriger au hasard. »

**Point de vigilance :** ne pas prétendre avoir tout écrit à la main. Si on te montre une ligne que tu ne comprends pas, dis-le et explique comment tu ferais pour la comprendre (lire la doc, la tester).

---

## 6. Les tests

- `npm test` lance `node --test` sur deux fichiers :
  - `tests/orders-format.test.mjs` : mise en forme (prix en euros, dates, frise des statuts) ;
  - `tests/rls.test.mjs` : **les règles de sécurité contre la vraie base**, avec des comptes de test. Par exemple : « un inconnu ne voit rien », « un email non vérifié ne voit rien », « l'acheteur ne peut pas changer un statut », « un statut ne peut pas revenir en arrière », « personne ne peut insérer ni supprimer depuis le navigateur ».
- **Pourquoi tester la RLS ?** C'est la partie où une erreur serait grave : un client verrait les commandes des autres. Un test le prouve à chaque fois.
- Les mots de passe et la connexion à la base sont dans `tests/.env`, **qui n'est pas sur GitHub**.

---

## 7. Limites connues et améliorations possibles

Les citer toi-même montre du recul.
- **Catalogue en double** : les produits sont dans `script.js` (affichage) et dans le workflow n8n (prix). À terme : une table `products` en base, ou les *Prices* Stripe.
- **Paiements asynchrones** (Klarna, virement…) : l'événement `async_payment_succeeded` n'est pas géré.
- **Gmail OAuth expire** régulièrement. En production, je passerais par un service d'emailing transactionnel (Brevo, Resend…).
- **n8n sur un VPS avec une adresse `nip.io`** : pratique pour un projet, mais en vrai il faudrait un nom de domaine, des sauvegardes et de la supervision.
- **Cookies tiers** : la connexion n'a pas été testée sur Safari ni en navigation privée.
- Pas de framework ni d'étape de build : simple, mais moins adapté si le site grossit.

---

## 8. Questions probables et réponses

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
R : Non. Le navigateur n'envoie que l'identifiant du produit et la quantité. C'est n8n qui fixe le prix à partir de son catalogue. Je l'ai vérifié en envoyant exprès un faux prix : Stripe a quand même reçu le vrai montant. C'est la règle de base : ne jamais faire confiance à ce qui vient du navigateur.

**Q : Qu'est-ce que tu améliorerais en premier ?**
R : Mettre le catalogue produits en base (une seule source pour l'affichage et les prix), gérer les paiements asynchrones, et remplacer Gmail par un service d'emails transactionnels.

**Q : Quelle a été la plus grosse difficulté ?**
R : Exemples réels : rendre la sécurité indépendante du navigateur (RLS + vérification de l'admin dans n8n) ; le cache de la Data API Neon après un changement de colonnes (erreur `42703`, il faut ré-enregistrer les schémas) ; le jeton Gmail qui expire.

---

## 9. Glossaire

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

## 10. Où regarder dans le projet

| Je veux montrer… | Fichier |
|---|---|
| L'état du projet | `PROJET-AURA.md` |
| La structure de la base et les règles de sécurité | `db/migrations/001_orders.sql`, `002_drop_demo.sql` |
| La connexion et l'appel à la base depuis le site | `js/neon-client.js` |
| Le back-office | `admin.html`, `js/admin.js` |
| Le formulaire de contact | `contact.html`, `js/contact.js` |
| Les workflows n8n (exports) | `n8n/aura-creer-session-stripe.json`, `n8n/aura-confirmation-paiement.json`, `n8n/aura-statut-commande.json` |
| Les tests de sécurité | `tests/rls.test.mjs` |
| La méthode de travail | `docs/superpowers/specs/…`, `docs/superpowers/plans/…`, `git log --oneline` |
