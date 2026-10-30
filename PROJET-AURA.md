# AURA — État du projet

Récapitulatif de session : e-commerce de lunettes de soleil (site statique HTML/CSS/JS) + automatisation paiement via n8n/Stripe.

**Projet fictif / démo** — publié sur GitHub Pages (`https://franck93-sel.github.io/sunglasses-shop/`) pour être montré, mais reste en mode test/sandbox (Stripe test, n8n de démo) : pas de mise en production réelle (clés live, domaine).

## ✅ Fait

### Site (front)
- **Images produits** : 6 produits, chacun avec sa propre photo (plus de doublons). `product-5.png` / `product-6.png` ajoutées (femme cat-eye écaille / homme aviator or).
- **Catégories homme/femme** ajoutées aux produits (`script.js`), filtres Homme/Femme/Tout Voir sur `shop.html` connectés et fonctionnels (y compris via `?category=homme` dans l'URL).
- **Page d'accueil enrichie** : section "Maison Aura" (histoire/savoir-faire) + bande de réassurance (livraison, retours, fabrication petite série). Le lien de nav "Maison Aura" pointe maintenant vraiment dessus (avant : lien mort vers le footer).
- **Bug panier corrigé** : le panier était en mémoire JS pure, donc vidé à chaque changement de page → passage à `localStorage` (`saveCart()`), le panier survit maintenant à la navigation shop → checkout.

### Paiement Stripe via n8n
- Connexion MCP à l'instance n8n (`https://n8n.212.227.12.49.nip.io`) établie et fonctionnelle.
- **Workflow n8n "AURA — Créer session Stripe Checkout"** (actif) : reçoit le panier via webhook (`/webhook/aura-checkout`), construit les `line_items` Stripe, crée une session Stripe Checkout (mode test) via l'API Stripe, renvoie l'URL de paiement.
- **Workflow n8n "AURA — Confirmation paiement Stripe"** (actif) : écoute l'événement `checkout.session.completed` (Stripe Trigger), extrait les infos de commande, envoie un email de confirmation via Gmail.
- `checkout.html` branché sur le workflow : le bouton "Payer avec Stripe" envoie le panier au webhook n8n et redirige vers la vraie page Stripe Checkout (testé de bout en bout, paiement test réussi).
- Nouvelle page `checkout-success.html` (vide le panier après retour de paiement réussi).
- Credentials n8n configurés : Stripe (`stripeApi`), Bearer Auth (pour l'appel HTTP direct à l'API Stripe côté création de session), Gmail (`gmailOAuth2`).

## ✅ Corrigé

- **Email de confirmation** : le credential Gmail avait un token OAuth2 expiré/révoqué (`invalid_grant`). Reconnecté dans n8n (`Credentials` → "Gmail account" → Reconnect). Testé de bout en bout le 2026-08-12 : ajout panier → checkout → paiement Stripe test (carte 4242) → email "Confirmation de votre commande AURA" bien reçu.

## ✅ Espace client & back-office (branche `feature/espace-client`)

Spec : `docs/superpowers/specs/2026-10-29-espace-client-design.md` — plan : `docs/superpowers/plans/2026-10-29-espace-client.md`.

### Architecture
```
Navigateur (pages statiques)
  ├─ Neon Auth ........ connexion / inscription (SDK @neondatabase/neon-js via esm.sh)
  └─ Neon Data API .... lecture des commandes, changement de statut (JWT + RLS)
Stripe ── checkout.session.completed ──▶ n8n « Confirmation paiement » ──▶ INSERT Neon + email
admin.html ── après « Expédiée » ──▶ n8n webhook aura-order-status ──▶ email « en route »
n8n planifié (04:00) ──▶ app.reset_demo()
```
Pas de repli via n8n : Neon Auth + Data API suffisent (le JWT donne `auth.user_id()`, l'email est relu dans `neon_auth."user"`).

### Base (Neon, projet `aura`, id `misty-moon-24213768`, schéma `app`)
- Migration : `db/migrations/001_orders.sql` ; données de démo : `db/seed-demo.sql`.
- `app.orders` (numéro `AUR-xxxx`, email, total, statut `payee` → `expediee` → `livree`, suivi `FR-AURA-xxxxx` généré au passage en « Expédiée », `stripe_session_id` **unique**, `is_demo`), `app.order_items`, `app.admins` (`user_id`, scope `all` | `demo`), vue `app.admin_kpis` (`security_invoker`).
- Le statut ne peut pas revenir en arrière (trigger). Le navigateur ne peut ni insérer ni supprimer : seul n8n insère (connexion serveur).
- Si la Data API ne voit plus le schéma `app` après une recréation : re-sauvegarder `db_schemas` dans la console Neon.

### Rôles (appliqués en RLS, testés dans `tests/rls.test.mjs`)
- **Acheteur** : lit les commandes dont l'email = l'email **vérifié** de son compte (`app.current_email()`).
- **Admin privé** (compte du propriétaire, scope `all`) : lit et modifie toutes les commandes.
- **Admin démo** (scope `demo`) : mêmes droits, uniquement sur `is_demo = true` ; ses KPIs ne comptent que celles-ci.

### Comptes de démo (boutons sur `compte.html`)
- `client@aura-demo.fr` et `admin@aura-demo.fr`, mot de passe public `aura-demo-2026`.
- Les commandes de démo n'envoient pas de vrai email (`simulated: true`, message « simulé pour la démo »).

### Workflows n8n (exports dans `n8n/`)
- **Confirmation paiement** (`Bsa9nENq2xyVBJfu`) : relit la session chez Stripe (`GET /v1/checkout/sessions/{id}`), n'enregistre que si `payment_status = paid`, insert idempotent (rejeu Stripe = pas de doublon), alerte Gmail au propriétaire si l'insert échoue.
- **Statut commande** (`KBlcWdPHE1kPUgyn`, webhook `aura-order-status`) : reçoit `{orderId}`, envoie l'email « en route » seulement si statut `expediee` et email pas encore envoyé (garde atomique), renvoie `{sent, simulated}`.
- **Reset démo** (`K1iRgKyoIGZRc0pv`) : chaque jour à 04:00, `app.reset_demo()` (ne touche que les lignes `is_demo`).
- Credential Postgres n8n : « Postgres account » (`V0ZMCCxh2dSUoJN6`) → **à recréer** à la main si le projet est cloné (chaîne de connexion Neon, SSL), puis relier les nœuds Postgres.

### Tests
`npm test` (Node ≥ 20, fichier `tests/.env` non commité : comptes de test et URL Neon).

### Vérification d'email (code à 6 chiffres)
Activée le 2026-10-30 dans la console Neon (Settings → Better Auth : « Verify at Sign-up », méthode **Verification code** ; la méthode « lien » exige un fournisseur SMTP personnalisé). Un compte non vérifié ne peut pas se connecter (`email_not_confirmed`) : `compte.html` affiche alors l'étape « Vérifiez votre email » et envoie un code (expire en 5 min ; chaque nouvel envoi remplace le précédent). Après validation, connexion automatique. Expéditeur : `auth@mail.myneon.app` (fournisseur partagé Neon). La base continue d'exiger un email vérifié pour lier les commandes (`app.current_email()`).

## 🔜 Reste à faire / pistes
- Sessions avec cookies tiers bloqués (Safari, navigation privée Chrome) : à vérifier sur GitHub Pages.
- Paiements asynchrones (Klarna, Bancontact…) : `checkout.session.async_payment_succeeded` non géré → ces commandes ne sont pas enregistrées.
- Webhook `aura-order-status` non authentifié (effet borné par la garde en base) ; amélioration possible : envoyer le JWT Neon et vérifier `admin_scope` dans n8n.
- Le nœud HTTP Request Stripe (création de session) utilise un credential **Bearer Auth** séparé du credential Stripe natif — limitation de l'outil MCP n8n qui ne peut pas lier un credential générique automatiquement. Si ce credential doit être recréé un jour, il faudra relier le nœud "Créer Session Stripe" à la main dans l'éditeur n8n.
- Pas de page "Accessoires" ni de produits dans cette catégorie malgré le filtre présent sur `shop.html` — filtre fonctionnel mais catalogue vide pour l'instant.
- `.mcp.json` (config du serveur MCP n8n) est désormais ignoré par git (ajouté au `.gitignore`) — à garder en tête si le projet est cloné ailleurs, il faudra recréer ce fichier et les credentials.

## ⏭️ Non applicable (site fictif, pas de mise en production)
- Bascule en mode production (clés Stripe live), domaine personnalisé.
