# Espace client & back-office AURA — design

Date : 2026-10-29

## Intention

AURA est un e-commerce **fictif** de lunettes de soleil (site statique HTML/CSS/JS + n8n + Stripe en mode test), destiné à être montré à un **recruteur**. Aujourd'hui, une commande passe par Stripe puis n8n envoie un email, mais **rien n'est stocké**.

On ajoute une vraie base de données, un espace acheteur et un back-office admin, reliés par des automatisations n8n. Le but est qu'un recruteur voie en quelques minutes un produit complet où front, base de données, authentification et automatisations travaillent ensemble.

## Objectifs

1. **Enregistrer chaque commande payée** dans une base PostgreSQL (Neon), en plus de l'email de confirmation actuel.
2. **Espace acheteur** : connexion, liste de ses commandes avec suivi de statut **Payée → Expédiée → Livrée** et un numéro de suivi (fictif).
3. **Back-office admin** : 4 chiffres clés (chiffre d'affaires, nombre de commandes, commandes à expédier, produit le plus vendu) + tableau de toutes les commandes avec changement de statut.
4. **Automatisation de suivi** : quand l'admin passe une commande à « Expédiée », n8n envoie automatiquement au client l'email « Votre commande est en route » (avec le numéro de suivi).
5. **Mode démo** : sur la page de connexion, deux boutons (Acheteur / Admin) pour entrer sans créer de compte. Les deux comptes ont des commandes d'exemple pour que les écrans ne soient pas vides.

## Non-objectifs

- Remboursements, gestion du stock, édition du catalogue depuis l'admin.
- Mise en production réelle (clés Stripe live, domaine, etc.) — le projet reste une démo.
- Changer le parcours d'achat : **l'achat reste possible sans compte**.

## Anti-objectifs (échec même si ça « marche »)

- Un rendu qui « fait IA » : pas d'emojis décoratifs (ex. cible, éclair) dans l'interface. Le style suit le site existant : noir/or, Playfair Display + Inter, variables de `styles.css`.
- Un acheteur qui peut voir les commandes d'un autre, ou un non-admin qui peut modifier un statut. Les droits doivent être appliqués **côté base** (pas seulement masqués dans l'interface) — c'est un point qu'un recruteur technique regardera.
- Des secrets (clé API Neon, chaîne de connexion, clés Stripe) visibles dans le code du navigateur ou commités.

## Décisions prises

- **Base : Neon (PostgreSQL), plan gratuit.** Choix de Claude, validé par l'utilisateur (refus de Supabase à cause du passage au payant). Le MCP Neon est connecté et peut créer le projet.
- **Comptes : Neon Auth.** Choix de Claude.
- **Lien commande ↔ client : par l'adresse email.** Une commande payée sans compte apparaît dans l'espace de la personne dès qu'elle se connecte avec la même adresse. Décision de l'utilisateur.
- **Deux rôles : acheteur et admin.** Décision de l'utilisateur.
- **Comptes de démo** avec identifiants affichés sur la page de connexion. Décision de l'utilisateur.
- **Admin de démo limité aux commandes fictives.** Décision de l'utilisateur. Les commandes portent un indicateur `is_demo`. Le compte admin de démo (identifiants publics) ne voit et ne modifie **que** les commandes `is_demo = true` ; ses KPIs ne comptent que celles-ci. Un **admin privé** (compte de l'utilisateur, identifiants jamais affichés) voit et gère toutes les commandes. Appliqué en RLS, pas seulement dans l'interface.
- **Hébergement : GitHub Pages, tel quel.** Décision de l'utilisateur. URL publique : `https://franck93-sel.github.io/sunglasses-shop/` (pages à la racine de ce chemin, ex. `.../index.html`). C'est l'origine à autoriser dans Neon Auth (domaines de confiance, redirections) et en CORS côté Neon Data API et webhooks n8n. Garder aussi l'origine locale de dev si besoin pour tester.
- **Maquettes validées** (3 écrans : connexion + encart démo, « Mes commandes » avec frise de statut, tableau de bord admin). Référence : `.superpowers/brainstorm/1389-1793265427/content/espace-client-v2.html` (dossier non commité).

## Contraintes existantes

- Site **statique**, pas de serveur applicatif. Pages existantes : `index.html`, `shop.html`, `checkout.html`, `checkout-success.html`, pages légales. Logique commune dans `script.js` (catalogue de 6 produits, panier en `localStorage` sous `auraCart`).
- n8n auto-hébergé : `https://n8n.212.227.12.49.nip.io`.
  - Workflow **« AURA — Créer session Stripe Checkout »** : webhook `/webhook/aura-checkout`, reçoit `{ items, email, successUrl, cancelUrl }`, renvoie `{ checkoutUrl }`.
  - Workflow **« AURA — Confirmation paiement Stripe »** : Stripe Trigger `checkout.session.completed` → extraction des infos → email Gmail.
- Le credential Gmail de n8n expire régulièrement (app OAuth Google en mode « Testing ») : ne pas le confondre avec un bug de la nouvelle fonctionnalité.
- Le nœud HTTP « Créer Session Stripe » utilise un credential Bearer Auth relié à la main ; ne pas le casser en modifiant ce workflow.

## Architecture visée

```
Navigateur (pages statiques)
  ├─ Neon Auth ............ connexion / inscription
  └─ Neon Data API ........ lecture des commandes, changement de statut (JWT + RLS)

Stripe ── checkout.session.completed ──▶ n8n « Confirmation paiement »
                                           ├─ INSERT commande + lignes dans Neon
                                           └─ email de confirmation (existant)

Page admin ── après changement de statut ──▶ n8n webhook « statut commande »
                                              └─ relit la commande dans Neon,
                                                 envoie l'email « en route » si besoin
```

### Données (à affiner par le builder)

- `orders` : id, numéro lisible (ex. `AUR-1042`), email client, total, statut (`payee` | `expediee` | `livree`), numéro de suivi, dates de chaque étape, id de session Stripe (**unique**, pour qu'un événement Stripe rejoué ne crée pas de doublon), date d'envoi de l'email « en route ».
- `order_items` : commande, nom du produit, prix, quantité.
- Un moyen de savoir qui est admin (table ou rôle), utilisable par les règles RLS.
- Les KPIs peuvent venir d'une vue SQL réservée à l'admin.

### Règles d'accès (RLS)

- Un acheteur connecté lit uniquement les commandes dont l'email = l'email de son compte.
- L'admin privé lit toutes les commandes et peut modifier statut + numéro de suivi.
- L'admin de démo a les mêmes droits, mais **uniquement** sur les commandes `is_demo = true`.
- Personne ne crée de commande depuis le navigateur : seul n8n insère (via sa propre connexion serveur).

### Email « en route »

Le webhook n8n de changement de statut ne reçoit que l'id de la commande. n8n relit la commande dans Neon et n'envoie l'email que si le statut est `expediee` **et** que l'email n'a pas déjà été envoyé (puis enregistre la date d'envoi). Ainsi, appeler le webhook plusieurs fois ou sans être admin n'a pas d'effet. Pour une commande `is_demo`, aucun email réel n'est envoyé (voir plus bas).

## Décisions laissées au builder (choix de Claude, à vérifier par l'utilisateur)

- **Solution de repli si Neon ne suffit pas** : si Neon Auth / la Data API ne permettent pas d'appliquer ces règles (ex. pas d'email exploitable dans le JWT pour la RLS), le builder peut passer à n8n comme API intermédiaire (n8n vérifie le JWT puis interroge Neon avec un rôle restreint), sans revenir demander. Le noter dans les notes du projet.
- **Emails des commandes de démo** : les commandes d'exemple appartiennent à une adresse fictive (`client@aura-demo.fr`) → pas de vrai email envoyé pour elles ; l'interface admin affiche une confirmation « email envoyé au client » et l'exécution reste visible dans n8n.
- **Remise à zéro de la démo** : un workflow n8n planifié (une fois par jour) remet les commandes de démo dans leur état initial, pour qu'un recruteur trouve toujours des écrans propres.
- **Vérification de l'email à l'inscription** : à activer dans Neon Auth si c'est possible, sinon n'importe qui pourrait créer un compte avec l'email de quelqu'un d'autre et voir ses commandes. À défaut, le signaler dans les notes du projet.
- Nom et emplacement des nouvelles pages (ex. `compte.html`, `mes-commandes.html`, `admin.html`) et ajout d'une icône « compte » dans la barre de navigation.
- Chargement du SDK Neon dans des pages statiques (CDN) et forme exacte de l'appel à la Data API — vérifier dans la documentation Neon à jour.
- Numéro de suivi fictif : saisi par l'admin ou généré automatiquement au passage en « Expédiée ».

## Comment on saura que c'est réussi

- Paiement test (carte 4242) sans compte → la commande apparaît en base, l'email de confirmation part comme avant.
- Inscription avec le même email → la commande s'affiche dans « Mes commandes » avec le statut « Payée ».
- Connexion admin → la commande apparaît, les KPIs se mettent à jour ; passage à « Expédiée » → l'email « en route » arrive, la frise du client avance.
- Un acheteur connecté qui tente de lire une autre commande via la Data API ou de changer un statut est refusé par la base.
- Les deux boutons démo fonctionnent en un clic et montrent des écrans remplis.
- Connecté en admin de démo, aucune commande réelle n'est visible ni modifiable, y compris en appelant directement la Data API.
- Tout fonctionne depuis `https://franck93-sel.github.io/sunglasses-shop/`.
