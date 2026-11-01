# AURA — État du projet

E-commerce **fictif** de lunettes de soleil : site statique (HTML/CSS/JS) publié sur GitHub Pages, paiement Stripe en mode test, base Neon (PostgreSQL), automatisations n8n.

- Site en ligne : `https://franck93-sel.github.io/sunglasses-shop/`
- Reste en mode test/sandbox : pas de clés Stripe live ni de domaine personnalisé.

_Dernière mise à jour : 2026-11-01._

## ✅ Fait

### Boutique (front)
- 6 produits avec chacun sa photo (`img/product-1.png` à `product-6.png`), catégories Homme / Femme, filtres sur `shop.html` (aussi via `?category=homme`).
- Page d'accueil : section « Maison Aura » + bande de réassurance ; lien de nav « Maison Aura » corrigé.
- Panier conservé entre les pages (`localStorage`, clé `auraCart`).
- Pages légales (mentions, CGV, confidentialité) avec bandeau « site de démonstration ».

### Paiement Stripe via n8n
- **« AURA — Créer session Stripe Checkout »** (`SvSQbihZ2NYiNtBH`, export `n8n/aura-creer-session-stripe.json`) : webhook `/webhook/aura-checkout` ← panier de `checkout.html` (**id + quantité seulement**) → « Valider Panier » (quantité 1–10, URL de retour limitées au site et à localhost) → « Lire Prix (Neon) » (`app.products`, produits actifs) → session Stripe Checkout (test) avec les noms et prix de la base → redirection vers Stripe. Produit inconnu/désactivé : pas de session (réponse vide, la page affiche une erreur). Retour sur `checkout-success.html` (vide le panier).
- **« AURA — Confirmation paiement Stripe »** (`Bsa9nENq2xyVBJfu`) : sur `checkout.session.completed`, deux branches indépendantes :
  - email de confirmation Gmail (nom du client échappé contre l'injection HTML) ;
  - enregistrement en base : relit la session chez Stripe, n'enregistre que si `payment_status = paid`, insert idempotent (un événement rejoué ne crée pas de doublon), alerte Gmail au propriétaire si l'enregistrement échoue.

### Espace client & back-office
Spec : `docs/superpowers/specs/2026-10-29-espace-client-design.md` — plan (cases cochées) : `docs/superpowers/plans/2026-10-29-espace-client.md`.

```
Navigateur (pages statiques)
  ├─ Neon Auth ........ connexion / inscription (SDK @neondatabase/neon-js via esm.sh)
  └─ Neon Data API .... lecture des commandes, changement de statut (JWT + RLS)
Stripe ── checkout.session.completed ──▶ n8n « Confirmation paiement » ──▶ INSERT Neon + email
admin.html ── après « Expédiée » (JWT admin) ──▶ n8n webhook aura-order-status ──▶ email « en route »
```

- **`compte.html`** : connexion / création de compte avec **vérification de l'email par code à 6 chiffres** (envoyé par Neon, valable 5 min, chaque nouvel envoi remplace le précédent ; bouton « Renvoyer le code »). Un compte non vérifié qui se connecte reçoit un code automatiquement. Connexion automatique après validation.
- **`mes-commandes.html`** (acheteur) : ses commandes avec frise Payée → Expédiée → Livrée, articles et numéro de suivi. Une commande payée sans compte apparaît dès qu'on se connecte avec le même email (vérifié).
- **`admin.html`** (back-office) : 4 indicateurs (chiffre d'affaires, commandes, à expédier, top produit) + tableau des commandes avec changement de statut. Passage à « Expédiée » → n8n envoie l'email « Votre commande est en route ».
- Icône compte dans la barre de navigation de toutes les pages (`js/nav-account.js`).

### Formulaire de contact
`contact.html` + `js/contact.js` → Web3Forms (clé publique dans `js/config.js`) → email dans la boîte Gmail du propriétaire. Champ anti-spam `botcheck`. Pas de workflow n8n.

### Base de données (Neon, projet `aura`, id `misty-moon-24213768`, schéma `app`)
- Migrations : `db/migrations/001_orders.sql`, puis `002_drop_demo.sql`, puis `003_products.sql`.
- `app.orders` : numéro `AUR-xxxx`, email, total, statut `payee` → `expediee` → `livree` (pas de retour en arrière), suivi `FR-AURA-xxxxx` généré au passage en « Expédiée », `stripe_session_id` unique.
- `app.order_items`, `app.admins` (`user_id`, scope `all`), vue `app.admin_kpis`.
- `app.products` : **catalogue unique** (nom, prix, catégorie, image, `active`, `sort_order`). Lu par la boutique (`script.js`, jeton anonyme Neon Auth `/token/anonymous`) et par n8n (prix Stripe). Modifier un prix / ajouter un produit : console Neon (aucune écriture possible depuis le navigateur). `active = false` retire le produit de la boutique et du paiement.
- **Droits appliqués par la base (RLS)**, testés dans `tests/rls.test.mjs` :
  - acheteur : lit seulement les commandes dont l'email = l'email **vérifié** de son compte ;
  - admin (compte du propriétaire) : lit tout, ne modifie que statut + numéro de suivi ;
  - personne ne peut créer ni supprimer de commande depuis le navigateur (seul n8n insère).

### Workflow « AURA — Statut commande » (`KBlcWdPHE1kPUgyn`)
Webhook `aura-order-status`, appelé par `admin.html` avec `Authorization: Bearer <JWT Neon>`. n8n fait vérifier le jeton par la Data API (`rpc/admin_scope`) : refus 401 si l'appelant n'est pas admin. Ensuite l'email « en route » ne part que si la commande est `expediee` et que l'email n'a pas déjà été envoyé (garde atomique en base). Réponse `{ sent }`.

### Mode démo : retiré le 2026-10-30
Les comptes `client@` / `admin@aura-demo.fr`, les commandes fictives, le rôle « admin démo » et le workflow de remise à zéro quotidienne ont été supprimés. Pour montrer le back-office à quelqu'un : lui faire créer un compte, puis ajouter son `user_id` dans `app.admins`.

### Tests
`npm test` → 24 tests (droits RLS commandes et produits + mise en forme des commandes). Nécessite `tests/.env` (non commité : URL Neon et comptes de test `rls-*@aura-demo.fr`).

## ⚠️ À savoir (maintenance)
- **Gmail** : le credential OAuth de n8n expire régulièrement (`invalid_grant`). Si les emails ne partent plus : n8n → Credentials → « Gmail account » → Reconnect. Choix assumé : on garde le nœud Gmail (pas de SMTP).
- **Data API Neon** : après un changement de colonnes, re-sauvegarder les schémas exposés (`db_schemas`, console Neon ou MCP `update_data_api`), sinon elle garde l'ancienne liste de colonnes (erreur `42703`).
- **Credentials n8n à recréer si le projet est cloné** : Postgres « Postgres account » (chaîne de connexion Neon, SSL), Stripe, Bearer Auth (relié **à la main** au nœud « Créer Session Stripe »), Gmail. `.mcp.json` est ignoré par git : à recréer aussi.

## 🔜 Reste à faire / pistes
- Tester la connexion sur Safari et en navigation privée depuis GitHub Pages (cookies tiers).
- Refaire un paiement test depuis le site en ligne, puis l'expédier depuis l'admin en ligne (email « en route » reçu ?).
- Paiements asynchrones (Klarna, Bancontact…) : `checkout.session.async_payment_succeeded` non géré → ces commandes ne seraient pas enregistrées.
- Filtre « Accessoires » sur `shop.html` sans produit.
- Nouvelles automatisations n8n (à définir).
