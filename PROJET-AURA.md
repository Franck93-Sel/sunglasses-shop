# AURA — État du projet

Récapitulatif de session : e-commerce de lunettes de soleil (site statique HTML/CSS/JS) + automatisation paiement via n8n/Stripe.

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

## 🔜 Reste à faire / pistes
- Vérifier/adapter les URLs `successUrl` / `cancelUrl` envoyées à Stripe : actuellement calculées dynamiquement depuis `window.location`, donc dépendantes du domaine réel une fois le site déployé (à revalider en prod, pas seulement en local).
- Le nœud HTTP Request Stripe (création de session) utilise un credential **Bearer Auth** séparé du credential Stripe natif — limitation de l'outil MCP n8n qui ne peut pas lier un credential générique automatiquement. Si ce credential doit être recréé un jour, il faudra relier le nœud "Créer Session Stripe" à la main dans l'éditeur n8n.
- Basculer Stripe et le webhook n8n en mode **production** (clés live, workflow toujours actif) avant une vraie mise en ligne — tout est actuellement en mode **test/sandbox**.
- Pas de page "Accessoires" ni de produits dans cette catégorie malgré le filtre présent sur `shop.html` — filtre fonctionnel mais catalogue vide pour l'instant.
- Pas de vérification serveur de la session Stripe sur `checkout-success.html` (on fait confiance à la redirection) — pour une vraie prod, prévoir une vérification du paiement côté n8n/serveur avant d'afficher la confirmation.
- `.mcp.json` (config du serveur MCP n8n) est désormais ignoré par git (ajouté au `.gitignore`) — à garder en tête si le projet est cloné ailleurs, il faudra recréer ce fichier et les credentials.
