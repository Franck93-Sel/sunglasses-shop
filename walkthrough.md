# Site E-Commerce "AURA" — Revue

Site vitrine et e-commerce de la marque fictive AURA (lunettes de soleil premium). L'état détaillé du projet (paiement, espace client, back-office, n8n) est dans [PROJET-AURA.md](PROJET-AURA.md).

## Réalisations
- **Fondations** : [index.html](index.html), [styles.css](styles.css) (variables CSS, flexbox/grid) et [script.js](script.js) (catalogue, interface et panier).
- **Design premium** : mode sombre avec accents dorés (`#cfa15f`), animations au défilement, navbar en glassmorphism.
- **Interactivité** :
  - **Panier coulissant** : ajout depuis la grille, total calculé en direct, conservé entre les pages (`localStorage`).
  - **Menu mobile** : icône hamburger pour les écrans étroits.

## Pages
- [shop.html](shop.html) : la collection, filtres Homme / Femme / Accessoires.
- [checkout.html](checkout.html) : récapitulatif du panier, paiement réel en mode test via Stripe Checkout (n8n), retour sur [checkout-success.html](checkout-success.html).
- [compte.html](compte.html) : connexion / création de compte (vérification de l'email par code).
- [mes-commandes.html](mes-commandes.html) : suivi des commandes de l'acheteur.
- [admin.html](admin.html) : back-office (indicateurs + changement de statut).
- [contact.html](contact.html), [info.html](info.html) (livraison, retours, entretien), pages légales.

## Visuels
Bannière d'accueil `img/hero-bg.png` et une photo par produit (`img/product-1.png` à `img/product-6.png`) : L'Ombre, Éclipse, Soleil Noir, Horizon, Mirage, Zénith.

## Comment tester
- **En ligne** : https://franck93-sel.github.io/sunglasses-shop/
- **En local** : servir le dossier sur `http://localhost:5500` (origine autorisée par Neon Auth et n8n), par exemple avec l'extension Live Server ou `python -m http.server 5500`. Ouvrir le fichier directement (`file://`) ne permet pas la connexion au compte.
- Parcours : ajouter au panier → **Procéder au paiement** → carte test Stripe `4242 4242 4242 4242` → email de confirmation → créer un compte avec le même email pour voir la commande dans « Mes commandes ».
