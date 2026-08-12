# AURA — État du projet

Récapitulatif de session : e-commerce de lunettes de soleil (site statique HTML/CSS/JS) + automatisation paiement via n8n/Stripe.

**Projet fictif / démo** — ne sera pas mis en ligne en production. Reste en mode test/sandbox (Stripe test, n8n de démo) : les points liés à une vraie mise en production ne sont pas à traiter.

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
- Le nœud HTTP Request Stripe (création de session) utilise un credential **Bearer Auth** séparé du credential Stripe natif — limitation de l'outil MCP n8n qui ne peut pas lier un credential générique automatiquement. Si ce credential doit être recréé un jour, il faudra relier le nœud "Créer Session Stripe" à la main dans l'éditeur n8n.
- Pas de page "Accessoires" ni de produits dans cette catégorie malgré le filtre présent sur `shop.html` — filtre fonctionnel mais catalogue vide pour l'instant.
- `.mcp.json` (config du serveur MCP n8n) est désormais ignoré par git (ajouté au `.gitignore`) — à garder en tête si le projet est cloné ailleurs, il faudra recréer ce fichier et les credentials.

## ⏭️ Non applicable (site fictif, pas de mise en production)
- URLs `successUrl` / `cancelUrl` Stripe, bascule en mode production (clés live), vérification serveur de la session Stripe sur `checkout-success.html` — tout ceci ne concerne qu'un vrai déploiement en prod.
