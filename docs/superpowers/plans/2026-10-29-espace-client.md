# Espace client & back-office AURA — Implementation Plan

> **État au 2026-10-30 : plan terminé et en ligne** (branche fusionnée dans `main`, commit `720ab26`).
> Évolutions après le plan :
> - **Mode démo retiré** : comptes, commandes et rôle « admin démo », remise à zéro (Tasks 3 et 9) supprimés — migration `002_drop_demo.sql`. Les éléments « démo » des tâches ci-dessous sont donc historiques.
> - **Vérification d'email activée** (code à 6 chiffres, étape ajoutée sur `compte.html`).
> - **Webhook `aura-order-status` protégé** : JWT Neon exigé, vérifié par n8n via `rpc/admin_scope` ; réponse `{ sent }` (plus de `simulated`).
> - Nom du client échappé dans l'email de confirmation de paiement.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Stocker les commandes payées dans Neon, offrir un espace acheteur (suivi Payée → Expédiée → Livrée) et un back-office admin (KPIs + changement de statut déclenchant un email n8n), avec un mode démo sûr.

**Architecture:** Le site reste statique (GitHub Pages). Le navigateur parle directement à Neon Auth (comptes) et à la Neon Data API (lecture/màj des commandes), les droits étant appliqués en RLS dans Postgres. n8n est le seul à insérer des commandes (après `checkout.session.completed`) et à envoyer les emails ; il se connecte à Neon avec un credential Postgres serveur.

**Tech Stack:** HTML/CSS/JS vanilla (modules ES), `@neondatabase/neon-js` chargé depuis un CDN ESM, PostgreSQL (Neon, plan gratuit), n8n auto-hébergé, Stripe (test), Gmail (n8n). Tests : `node --test` (Node 24 présent sur la machine).

**Spec:** `docs/superpowers/specs/2026-10-29-espace-client-design.md`

## Global Constraints

- Origine publique : `https://franck93-sel.github.io` (site sous `/sunglasses-shop/`). À autoriser dans Neon Auth (trusted domains) et en CORS (Data API, webhooks n8n). Garder aussi l'origine locale de dev utilisée pour tester (ex. `http://localhost:5500`).
- n8n : `https://n8n.212.227.12.49.nip.io`. Ne pas casser le webhook `/webhook/aura-checkout` ni le nœud « Créer Session Stripe » (credential Bearer Auth relié à la main).
- Style : celui du site (`styles.css` : `--color-bg-main #0a0a0a`, `--color-accent #cfa15f`, Playfair Display + Inter). **Aucun emoji décoratif** dans l'interface.
- Statuts en base : `payee` | `expediee` | `livree` ; libellés affichés : « Payée », « Expédiée », « Livrée ».
- Numéro lisible : `AUR-` + séquence démarrant à `1001`.
- Comptes de démo (identifiants publics, affichés sur la page) : `client@aura-demo.fr` et `admin@aura-demo.fr`, mot de passe `aura-demo-2026`. Admin privé : compte de l'utilisateur, identifiants **jamais** dans le code.
- Aucun secret commité : chaîne de connexion Neon, clé API n8n, mot de passe admin privé → fichier `tests/.env` (gitignoré) ou credentials n8n. Seules les URLs publiques Auth/Data API vont dans le code.
- Le SDK est épinglé sur une version exacte (`npm view @neondatabase/neon-js version` au moment de l'implémentation), jamais `@latest` dans le site.
- Repli autorisé (spec) : si une règle RLS ci-dessous est impossible avec Neon Auth/Data API, passer par des webhooks n8n comme API (n8n vérifie le JWT, puis interroge Neon avec un rôle restreint) et le noter dans `PROJET-AURA.md`.

## Review Focus

1. **Session perdue entre deux pages** (cookies tiers bloqués : Safari, navigation privée Chrome) — l'utilisateur connecté sur `compte.html` doit l'être encore sur `mes-commandes.html` après rechargement. Test manuel dans la Task 4, sur Chrome normal + une fenêtre privée.
2. **Casse / espaces de l'email** (Stripe renvoie `Camille@Exemple.fr `, le compte est `camille@exemple.fr`) — la commande doit quand même apparaître. Test `email linking ignores case` (Task 2).
3. **Événement Stripe rejoué** — aucune commande en double. Test « replay » (Task 7).
4. **Admin de démo qui appelle la Data API à la main** pour lire/modifier une commande réelle, ou passer `is_demo` à `true`, ou changer l'email — refusé. Tests `demo admin cannot …` (Task 2).
5. **Double clic sur « Expédiée »** / webhook appelé deux fois — un seul email. Test (Task 8).

---

## File Structure

| Fichier | Rôle |
|---|---|
| `db/migrations/001_orders.sql` | Schéma `app`, tables, séquence, fonctions d'identité, trigger statut, grants, RLS, vue KPIs |
| `db/seed-demo.sql` | Fonction `app.reset_demo()` + son appel initial (commandes d'exemple) |
| `js/config.js` | URLs publiques Neon Auth / Data API / webhooks n8n |
| `js/neon-client.js` | Client Neon partagé + helpers d'auth |
| `js/orders-format.js` | Fonctions pures d'affichage (statuts, prix, dates) — testées |
| `compte.html` + `js/compte.js` | Connexion / inscription / boutons démo |
| `mes-commandes.html` + `js/mes-commandes.js` | Espace acheteur |
| `admin.html` + `js/admin.js` | Back-office |
| `styles.css` | Styles des nouvelles pages (ajouts en fin de fichier) |
| toutes les pages `*.html` | Icône « compte » dans `.nav-actions` |
| `package.json` | Dev only : `@neondatabase/neon-js` pour les tests, script `test` |
| `tests/helpers/session.mjs` | `signedInClient(email, password)` pour les tests |
| `tests/rls.test.mjs`, `tests/orders-format.test.mjs` | Tests |
| `n8n/*.json` | Export des workflows modifiés/créés (sans credentials) |
| `PROJET-AURA.md`, `confidentialite.html` | Docs à jour |

---

### Task 0: Prérequis (actions de l'utilisateur)

L'implémenteur s'arrête et demande à l'utilisateur, sans contourner :

- [x] **Step 1:** Clé API n8n — l'utilisateur définit `N8N_API_URL=https://n8n.212.227.12.49.nip.io` et `N8N_API_KEY` dans ses variables d'environnement Windows, puis redémarre Claude Code. Vérifier que les outils n8n de gestion de workflows (liste/màj de workflows) apparaissent ; sinon, les étapes n8n se feront en guidant l'utilisateur dans l'éditeur.
- [x] **Step 2:** Confirmer avec l'utilisateur la création d'un projet Neon `aura` (région Europe, ex. `aws-eu-central-1`) via le MCP Neon.

### Task 1: Projet Neon + Auth + Data API + spike navigateur

**Files:** Create: `js/config.js`, `js/neon-client.js`, `spike-neon.html` (supprimé en fin de tâche), `package.json`, `tests/.env` (gitignoré), `tests/helpers/session.mjs`. Modify: `.gitignore`.

**Interfaces — Produces:**
- `js/config.js` : `export const NEON_AUTH_URL`, `NEON_DATA_API_URL`, `N8N_ORDER_STATUS_WEBHOOK = 'https://n8n.212.227.12.49.nip.io/webhook/aura-order-status'`, `SITE_BASE = '/sunglasses-shop/'`.
- `js/neon-client.js` : `export const neon` (résultat de `createClient({ auth: { url }, dataApi: { url } })`) ; `export async function getUser(): Promise<{id, email, name} | null>` ; `export async function signIn(email, password): Promise<{error?: string}>` ; `export async function signUp(email, password, name): Promise<{error?: string}>` ; `export async function signOut(): Promise<void>` ; `export async function requireUser(redirectTo = 'compte.html')` (redirige si pas connecté, sinon renvoie l'utilisateur).
- `tests/helpers/session.mjs` : `export async function signedInClient(email, password)` → client neon-js connecté (Node).

- [x] **Step 1:** Via MCP Neon : créer le projet, activer Neon Auth et la Data API (« Use Managed Better Auth »), ajouter les trusted domains (`https://franck93-sel.github.io` + origine locale), activer la vérification d'email si l'option existe (sinon le noter pour la Task 10). Récupérer Auth URL, Data API URL, connection string (directe, non poolée) → `tests/.env` (`DATABASE_URL`, `NEON_AUTH_URL`, `NEON_DATA_API_URL`, `PRIVATE_ADMIN_EMAIL`, `PRIVATE_ADMIN_PASSWORD`). Ajouter `tests/.env` et `node_modules/` à `.gitignore`.
- [x] **Step 2:** Écrire `js/config.js` et `js/neon-client.js` (import ESM depuis `https://esm.sh/@neondatabase/neon-js@<version exacte>`).
- [ ] **Step 3:** *(partiel : Chrome normal OK ; fenêtre privée / Safari jamais testés)* Spike `spike-neon.html` servi en local : inscription, connexion, rechargement, `getUser()` toujours non nul, navigation vers une 2e page → toujours connecté. Tester Chrome normal + fenêtre privée.
  Expected : session conservée. **Si elle se perd** (cookies tiers), chercher dans la doc Neon l'option de session par jeton (bearer/JWT stocké côté client) ; à défaut, appliquer le repli des Global Constraints et prévenir l'utilisateur avant de continuer.
- [x] **Step 4:** `package.json` (`"type": "module"`, devDependency neon-js même version, script `"test": "node --env-file=tests/.env --test tests/"`), `npm install`, écrire `signedInClient`.
- [x] **Step 5:** Supprimer `spike-neon.html`, commit `feat: Neon client and config`.

### Task 2: Schéma, droits (RLS) et tests de sécurité

**Files:** Create: `db/migrations/001_orders.sql`, `tests/rls.test.mjs`.

**Interfaces — Produces (schéma `app`, exposé à la Data API — ajouter `app` aux schémas exposés ou utiliser `public` si la Data API n'expose que `public` ; dans ce cas mêmes noms dans `public`) :**
- `app.orders` : `id bigint identity pk`, `order_number text unique not null default 'AUR-' || nextval('app.order_number_seq')` (séquence start 1001), `email text not null` (stocké `lower(trim(...))` via trigger), `total numeric(10,2) not null`, `status text not null default 'payee' check (status in ('payee','expediee','livree'))`, `tracking_number text`, `paid_at timestamptz not null default now()`, `shipped_at timestamptz`, `delivered_at timestamptz`, `stripe_session_id text unique` (null pour la démo), `is_demo boolean not null default false`, `shipped_email_sent_at timestamptz`.
- `app.order_items` : `id bigint identity pk`, `order_id bigint not null references app.orders on delete cascade`, `product_name text not null`, `unit_price numeric(10,2) not null`, `quantity int not null check (quantity > 0)`.
- `app.admins` : `user_id text pk`, `scope text not null check (scope in ('all','demo'))`.
- `app.current_email() returns text` — `SECURITY DEFINER`, `search_path` fixé : `lower(email)` de `neon_auth."user"` où `id::text = auth.user_id()` **et** `"emailVerified"`.
- `app.admin_scope() returns text` — `SECURITY DEFINER` : `scope` de `app.admins` pour `auth.user_id()`, sinon `null`. `EXECUTE` accordé à `authenticated` : le navigateur l'appelle via `neon.rpc('admin_scope')` (Tasks 4 et 6).
- Trigger `before update` sur `orders` : si `status` passe à `expediee` → `shipped_at = now()` et, si `tracking_number` est null, `'FR-AURA-' || lpad((random()*99999)::int::text, 5, '0')` ; si passe à `livree` → `delivered_at = now()` (et `shipped_at` si null). Refuser un retour en arrière (`livree` → `payee`, etc.) par une exception.
- Vue `app.admin_kpis` **`with (security_invoker = true)`** : `revenue`, `order_count`, `to_ship` (statut `payee`), `top_product` — la RLS fait que l'admin démo ne voit que les chiffres de démo.
- Droits du rôle `authenticated` : `SELECT` sur `orders`, `order_items`, `admin_kpis` ; `UPDATE (status, tracking_number)` uniquement sur `orders` ; **aucun** `INSERT`/`DELETE`. Rien pour `anonymous`.
- Policies : `orders` SELECT et UPDATE si `email = app.current_email()` (SELECT seulement) **ou** `app.admin_scope() = 'all'` **ou** (`app.admin_scope() = 'demo'` **et** `is_demo`) ; UPDATE `with check` identique côté admin. `order_items` SELECT si la commande parente est visible (`exists` sur `orders`).

- [x] **Step 1: Write the failing tests** `tests/rls.test.mjs` (`node:test`). `before` : via `DATABASE_URL` (driver `@neondatabase/serverless`, devDependency) insérer une commande réelle `rls-test@aura-demo.fr` (`is_demo=false`) et une commande démo ; créer/assurer les comptes `rls-buyer@aura-demo.fr` (email vérifié en SQL), `rls-stranger@aura-demo.fr`, et utiliser `admin@aura-demo.fr` (scope `demo`) et l'admin privé (scope `all`). `after` : supprimer les lignes de test. Tests :
  - `buyer sees own order` — buyer dont l'email = commande réelle → 1 ligne.
  - `email linking ignores case` — commande insérée avec `'  RLS-Test@Aura-Demo.FR '` → visible par le buyer.
  - `stranger sees nothing` → 0 ligne, et `admin_kpis` vide/nul.
  - `unverified email sees nothing` — compte non vérifié avec le même email → 0 ligne.
  - `buyer cannot update status` → erreur ou 0 ligne modifiée, statut inchangé en base.
  - `demo admin sees only demo orders` → aucune ligne `is_demo=false`.
  - `demo admin cannot update a real order` → statut inchangé.
  - `demo admin cannot set is_demo or email` → erreur de permission.
  - `private admin sees all and can ship` → statut `expediee`, `shipped_at` et `tracking_number` remplis.
  - `status cannot go backwards` → passer une commande `livree` à `payee` échoue.
  - `nobody can insert from the browser` → `insert` refusé pour buyer et admins.
- [x] **Step 2:** `npm test` → FAIL (tables absentes).
- [x] **Step 3:** Écrire `001_orders.sql`, l'appliquer via MCP Neon (`run_sql_transaction`), insérer dans `app.admins` l'id de `admin@aura-demo.fr` (`demo`) et de l'admin privé (`all`) — créer ces comptes d'abord (inscription via SDK, puis `"emailVerified" = true` en SQL pour les comptes démo). Pour l'admin privé, demander à l'utilisateur son email et qu'il crée lui-même son mot de passe.
- [x] **Step 4:** `npm test` → tous PASS.
- [x] **Step 5:** Commit `feat: orders schema with row-level security`.

### Task 3: Données de démo et remise à zéro

> Fait, puis **retiré le 2026-10-30** avec le mode démo (`db/migrations/002_drop_demo.sql`).

**Files:** Create: `db/seed-demo.sql`. Test: `tests/rls.test.mjs` (ajout).

**Interfaces — Produces:** `app.reset_demo() returns void` (`SECURITY DEFINER`, exécutable seulement par le propriétaire / n8n) : supprime les commandes `is_demo` puis recrée un jeu fixe pour `client@aura-demo.fr` : 2 commandes (une `expediee` avec suivi `FR-DEMO-88213`, une `livree`) ; plus 4 commandes démo d'autres clients fictifs (`leo.m@aura-demo.fr`, `sam.r@aura-demo.fr`, …) dont 2 `payee`, pour remplir l'admin. Produits = noms réels du catalogue (`L'Ombre` 350, `Éclipse` 420, `Soleil Noir`, `Horizon`, `Mirage`, `Zénith` — prix repris de `script.js`). Dates relatives à `now()`.

- [x] **Step 1:** Test `reset_demo restores the demo set` : modifier une commande démo, appeler `select app.reset_demo()`, vérifier 6 commandes `is_demo`, 2 pour `client@aura-demo.fr`, statuts d'origine ; et qu'aucune commande `is_demo=false` n'a été touchée.
- [x] **Step 2:** `npm test` → FAIL. **Step 3:** écrire et appliquer `seed-demo.sql`. **Step 4:** PASS. **Step 5:** commit `feat: demo data and reset function`.

### Task 4: Page de connexion + icône compte

**Files:** Create: `compte.html`, `js/compte.js`. Modify: toutes les pages `*.html` (`.nav-actions`, avant `#cartBtn`), `styles.css`.

**Interfaces — Consumes:** `signIn`, `signUp`, `getUser`, `signOut` (Task 1). **Produces:** après connexion, redirection vers `admin.html` si `neon.rpc('admin_scope')` renvoie une valeur non nulle (fonction de la Task 2), sinon `mes-commandes.html`.

- [x] **Step 1:** `compte.html` reprend la nav/footer des autres pages et la maquette validée (`.superpowers/brainstorm/1389-1793265427/content/espace-client-v2.html`, écran 1) : formulaire email/mot de passe, bascule « Créer un compte », encart « Mode démo » (deux lignes Acheteur/Admin, emails affichés en clair + mot de passe `aura-demo-2026`, bouton « Entrer »). Pas d'emoji. Messages d'erreur en français dans la page (pas d'`alert`). À l'inscription, afficher « Vérifiez votre boîte mail » si la vérification est active.
- [x] **Step 2:** Icône compte (SVG trait, même style que le panier) dans la nav de toutes les pages, lien vers `compte.html` (ou `mes-commandes.html`/`admin.html` si connecté — résolu au chargement par `script.js` important `getUser` de manière non bloquante ; si le SDK ne charge pas, le lien reste `compte.html`).
- [ ] **Step 3:** *(partiel : redirections, message d'erreur et rechargement OK ; fenêtre privée non testée)* **Vérification manuelle** (serveur local) : boutons démo → bonne redirection ; mauvais mot de passe → message ; rechargement → toujours connecté (Review Focus 1, Chrome + fenêtre privée) ; mobile 375 px sans scroll horizontal.
- [x] **Step 4:** Commit `feat: account page and nav account link`.

### Task 5: Espace acheteur « Mes commandes »

**Files:** Create: `js/orders-format.js`, `tests/orders-format.test.mjs`, `mes-commandes.html`, `js/mes-commandes.js`. Modify: `styles.css`.

**Interfaces — Produces (`js/orders-format.js`, sans dépendance au DOM ni au SDK) :**
- `STATUS_LABELS = { payee: 'Payée', expediee: 'Expédiée', livree: 'Livrée' }`
- `timeline(order) -> [{ key, label, done: boolean, date: string|null }]` (3 étapes, dans l'ordre)
- `formatPrice(n) -> '289,00 €'` (`Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })`)
- `formatDate(iso) -> '27 oct. 2026'` (`fr-FR`, `day: 'numeric', month: 'short', year: 'numeric'`)

- [x] **Step 1: Failing tests:** `timeline` pour `payee` → `[true,false,false]`, `expediee` → `[true,true,false]`, `livree` → `[true,true,true]`, avec la date de chaque étape faite ; `formatPrice(289)` === `'289,00 €'` (comparer après remplacement des espaces insécables par des espaces) ; `formatDate('2026-10-27T10:00:00Z')` === `'27 oct. 2026'`.
- [x] **Step 2:** `npm test` → FAIL. **Step 3:** implémenter. **Step 4:** PASS.
- [x] **Step 5:** `mes-commandes.html` (`requireUser()`), « Bonjour, {name} · Déconnexion », liste des commandes (plus récentes d'abord) avec `order_items` imbriqués (`select('*, order_items(*)')`), badge, frise, articles, suivi ; état vide : « Aucune commande pour l'instant » + lien boutique, et rappel « Les commandes passées avec {email} apparaissent ici automatiquement ». Erreur réseau → message dans la page.
- [x] **Step 6: Vérification manuelle** avec `client@aura-demo.fr` : 2 commandes conformes à la maquette (écran 2). Commit `feat: buyer orders page`.

### Task 6: Back-office admin

**Files:** Create: `admin.html`, `js/admin.js`. Modify: `styles.css`.

**Interfaces — Consumes:** `requireUser`, `admin_scope` (Task 4), vue `admin_kpis`, `formatPrice`/`formatDate`/`STATUS_LABELS` (Task 5), `N8N_ORDER_STATUS_WEBHOOK` (Task 1). **Produces:** appel `POST N8N_ORDER_STATUS_WEBHOOK` avec `{ orderId: number }`, réponse attendue `{ sent: boolean, simulated: boolean }` (contrat implémenté en Task 8).

- [x] **Step 1:** `admin.html` : accès refusé (redirection `mes-commandes.html`) si `admin_scope` null. Bandeau discret « Mode démo — seules les commandes fictives sont visibles » si scope `demo`. 4 KPIs (Chiffre d'affaires, Commandes, À expédier, Top produit), tableau (Commande, Date, Client, Total, Statut) avec `<select>` limité aux statuts suivants possibles.
- [x] **Step 2:** Changement de statut : `update({ status })` via Data API → si succès et nouveau statut `expediee`, appeler le webhook ; afficher « Email « Votre commande est en route » envoyé au client » (ou « … (simulé pour la démo) » si `simulated`). Échec de l'update → remettre l'ancien statut + message. Échec du webhook → statut conservé + « Statut mis à jour, l'email n'a pas pu être envoyé ». Désactiver le `<select>` pendant l'appel (Review Focus 5). Recharger KPIs après chaque changement.
- [x] **Step 3: Vérification manuelle** : admin démo voit 6 commandes, aucune réelle ; passage à « Expédiée » met à jour la ligne et les KPIs. Commit `feat: admin back-office`.

### Task 7: n8n — enregistrer la commande après paiement

**Files:** Modify (dans n8n) : workflow « AURA — Confirmation paiement Stripe ». Create: `n8n/aura-confirmation-paiement.json` (export sans credentials).

**Interfaces — Consumes:** tables Task 2 ; credential n8n **Postgres** « Neon AURA » (créé par l'utilisateur dans l'éditeur n8n avec la connection string — l'implémenteur ne manipule pas le mot de passe).

- [x] **Step 1:** Après le Stripe Trigger, ajouter : HTTP Request `GET https://api.stripe.com/v1/checkout/sessions/{{ $json.data.object.id }}/line_items?limit=100` (credential Bearer Auth existant) → nœud Postgres qui exécute, dans une seule requête (CTE), l'`INSERT … ON CONFLICT (stripe_session_id) DO NOTHING RETURNING id` de la commande (email = `customer_details.email`, total = `amount_total / 100`) puis les `order_items` (`description`, `amount_total/quantity/100`, `quantity`) seulement si la commande vient d'être créée. Placer ces nœuds **en parallèle** de l'envoi Gmail : un échec Gmail ne doit pas empêcher l'enregistrement, et inversement.
- [x] **Step 2: Test** : paiement test (carte `4242 4242 4242 4242`) depuis le site → `select order_number, email, total, status from app.orders where not is_demo order by id desc limit 1` → 1 ligne `payee`, total = panier ; items = articles du panier. Email de confirmation reçu.
- [x] **Step 3: Test replay** (Review Focus 3) : dans Stripe (dashboard test → événement → « Renvoyer ») ou en rejouant l'exécution n8n → toujours 1 seule commande pour ce `stripe_session_id`.
- [x] **Step 4:** Se connecter sur le site avec l'email utilisé au paiement (inscription + vérification) → la commande apparaît. Exporter le workflow, commit `feat(n8n): store paid orders in Neon`.

### Task 8: n8n — email « Votre commande est en route »

**Files:** Create (dans n8n) : workflow « AURA — Statut commande » ; `n8n/aura-statut-commande.json`.

**Interfaces — Produces:** `POST /webhook/aura-order-status`, body `{ orderId }`, CORS autorisé pour `https://franck93-sel.github.io` + origine locale, réponse JSON `{ sent: boolean, simulated: boolean }`.

- [x] **Step 1:** Webhook → Postgres `select` de la commande + items → Switch :
  - commande introuvable ou statut ≠ `expediee` → `{ sent: false, simulated: false }` ;
  - `is_demo` → `{ sent: false, simulated: true }` (aucun email) ;
  - `shipped_email_sent_at` non null → `{ sent: false, simulated: false }` ;
  - sinon `update … set shipped_email_sent_at = now() where id = $1 and shipped_email_sent_at is null returning id` (garde atomique) → si une ligne : Gmail « Votre commande AURA est en route » (numéro, articles, numéro de suivi, lien `https://franck93-sel.github.io/sunglasses-shop/compte.html`, même ton/HTML que l'email de confirmation existant) → `{ sent: true, simulated: false }`.
- [x] **Step 2: Tests** (curl) : commande démo → `simulated: true` ; commande réelle `payee` → `sent: false` ; passer une commande réelle de test à `expediee` (admin privé sur le site) → `sent: true`, email reçu ; rappeler le webhook → `sent: false` (Review Focus 5), un seul email reçu ; `orderId` inexistant → `sent: false`, pas d'erreur 500.
- [x] **Step 3:** Export + commit `feat(n8n): shipped email workflow`.

### Task 9: n8n — remise à zéro quotidienne de la démo

> Fait, puis **workflow supprimé le 2026-10-30** avec le mode démo.

**Files:** Create (dans n8n) : workflow « AURA — Reset démo » ; `n8n/aura-reset-demo.json`.

- [x] **Step 1:** Schedule Trigger quotidien 04:00 (Europe/Paris) → Postgres `select app.reset_demo()`.
- [x] **Step 2: Test** : modifier une commande démo depuis l'admin démo, exécuter le workflow manuellement → état initial restauré, commandes réelles intactes. Activer le workflow. Export + commit `feat(n8n): daily demo reset`.

### Task 10: Documentation et vérification de bout en bout

**Files:** Modify: `PROJET-AURA.md`, `confidentialite.html`.

- [x] **Step 1:** `PROJET-AURA.md` : section « Espace client » (architecture, tables, rôles, comptes démo, workflows n8n, credential Postgres à recréer si clone, repli éventuel utilisé, état de la vérification d'email). Corriger la mention « ne sera pas mis en ligne » : le site est sur GitHub Pages.
- [x] **Step 2:** `confidentialite.html` : ajouter les données de compte (email, nom, historique de commandes stocké chez Neon) au paragraphe démo existant.
- [ ] **Step 3:** *(non fait d'un bloc : chaque critère a été vérifié dans sa tâche)* **Parcours complet en local** : les 5 critères « réussi » de la spec + les 2 ajoutés (admin démo sans commandes réelles ; origine GitHub Pages).
- [x] **Step 4:** `npm test` → tout PASS. Commit `docs: customer space notes`.
- [x] **Step 5:** *(push fait le 2026-10-30 ; en ligne vérifié : connexion acheteur démo. Paiement réel depuis GitHub Pages et expédition depuis l'admin en ligne : à faire par l'utilisateur)* **Demander à l'utilisateur** avant `git push` (le push publie sur GitHub Pages). Après le push, refaire le parcours sur `https://franck93-sel.github.io/sunglasses-shop/` (connexion démo, admin démo, paiement test réel → commande visible).
