# Mountain — Analyse technique du projet

> Rapport d'analyse produit le 2026-10-05 sur le commit `fbac46a` (branche `arena/01a10d53-mountain`).
> Toutes les assertions marquées ✅ ont été **vérifiées en exécutant le code** dans cet environnement.

> **Mise à jour — correctifs appliqués.** Les deux vulnérabilités **critiques** (#1 et #2) ont été
> corrigées et vérifiées depuis la rédaction de ce rapport. Voir la section 9 en fin de document.
> Les problèmes #3 à #10 restent **ouverts**.

---

## 1. Ce qu'est le projet

**Mountain** est une plateforme **SaaS e-commerce multi-tenant** inspirée du modèle Shopify : une
plateforme unique héberge de nombreux marchands indépendants, chacun disposant d'une boutique
isolée, d'un catalogue, de commandes, de clients et d'analytics.

Le projet est **spécification-first** : `generate_spec.py` génère un PDF de 19 pages
(`output/Mountain_Advanced_Ecommerce_Platform_Specification.pdf`), dont `docs/specification.md`
reprend les sections d'architecture. Le code suit ensuite cette spec phase par phase, avec des
marqueurs `TODO(phase-N)` dans le code.

**Volumétrie** : 123 fichiers versionnés, 14 workspaces npm, ~6 500 lignes de source
(dont 68 fichiers TS/TSX), 1 unique commit initial.

### Stack

| Couche | Technologie |
| --- | --- |
| Backend | Node 20+ / TypeScript, Express 4, **monolithe modulaire** |
| Base de données | MongoDB (Mongoose) + **fallback en mémoire** |
| Cache | Redis (ioredis) |
| Recherche | OpenSearch (non implémenté) |
| Front marchand / admin | React 18 + Vite (coquilles statiques) |
| Storefront | Next.js 15 (App Router) |
| IA | Python 3 + FastAPI (contrats seulement) |
| Paiement | Abstraction provider + provider `MOCK` |

### Organisation

```
apps/        merchant · storefront · admin · mobile (README seulement)
services/    api · ai · worker · search · notifications
packages/    auth · types · config · utils · ui (placeholder)
infrastructure/ docker · kubernetes (README) · terraform (README)
```

---

## 2. État de santé vérifié

J'ai exécuté la chaîne complète. **Le socle est étonnamment sain pour un scaffolding :**

| Vérification | Résultat |
| --- | --- |
| `npm install` | ✅ 221 paquets, 11 s, aucune erreur |
| `npm run typecheck --workspaces` | ✅ **12/12 workspaces propres** |
| `npm run build --workspaces` | ✅ tous OK (Next.js génère 6 pages en SSG, Vite merchant+admin, tsc API/worker/search/notifications) |
| `node scripts/smoke.mjs` | ✅ **17/17 assertions passent** |

Le smoke test est un vrai parcours end-to-end, pas un test de façade :
`register → create tenant (+ store auto-provisionné + rôle OWNER) → login → create/activate
product → create order (totaux vérifiés numériquement à 290.78) → transition illégale rejetée
(409) → transition valide → paiement mock → remboursement → rotation du refresh token`.

**Le harnais TypeScript est strict et vert** : `strict`, `noUncheckedIndexedAccess`,
`noImplicitOverride`, `module: NodeNext`. C'est un bon signal de rigueur.

---

## 3. Ce qui est réellement implémenté

### Solide et fonctionnel

1. **Authentification** (`services/api/src/modules/auth/`) — register / login / refresh / me,
   hash bcrypt (coût 12), JWT HS256 via `jose`, politique de mot de passe validée par Zod
   (10 caractères min., majuscule, minuscule, chiffre).

2. **RBAC** (`packages/auth/`) — **le morceau le mieux conçu du dépôt**. 7 rôles marchands
   (OWNER, MANAGER, STAFF, ACCOUNTANT, MARKETING, FULFILLMENT, CUSTOMER_SUPPORT) et 7 rôles
   plateforme, avec permissions `resource.action` et support des wildcards `*` et `orders.*`.

3. **Multi-tenancy** — middleware `resolveTenant` : les tokens marchands sont **épinglés** à leur
   tenant (toute tentative de changement via `x-tenant-id` renvoie 403 `Tenant mismatch`),
   les admins plateforme peuvent cibler n'importe quel tenant.

4. **Cycle de vie tenant** — la création d'un tenant provisionne automatiquement la première
   boutique, la membership `OWNER`, et **ré-émet une paire de tokens scopée au tenant**.

5. **Produits** — CRUD complet avec pagination, recherche, variantes, médias, SEO,
   génération automatique de slug et de SKU, archivage (soft delete).

6. **Commandes** — création depuis des lignes d'articles, calcul des totaux, et surtout une
   **machine à états à 9 statuts** (`PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED`,
   plus CANCELLED / REFUNDED / RETURNED / FAILED) avec transitions invalides rejetées en 409 et
   un `timeline` horodaté. C'est du vrai travail de modélisation métier.

7. **Paiements** — **abstraction provider bien faite** (`PaymentProvider` interface + factory +
   `MockPaymentProvider`), avec capture, remboursement, annulation, statut. Le paiement réussi
   confirme automatiquement la commande. Brancher Stripe = implémenter une interface.

8. **API Storefront publique** — résolution de boutique par slug, catalogue actif avec
   recherche/filtre catégorie, produit par slug, et checkout invité.

9. **Persistance Mongo avec fallback mémoire** — pattern appliqué de façon cohérente sur
   users / memberships / tenants / stores / products.

10. **Health checks** — `/health`, `/health/live`, `/health/ready` avec état dégradé Mongo/Redis,
    et **démarrage découplé des dépendances** (l'API écoute avant de se connecter à Mongo, ce
    qui évite un crash au boot si la base est momentanément indisponible).

### En revanche — 13 modules ne sont que des coquilles

`categories`, `inventory`, `cart`, `customers`, `reviews`, `discounts`, `shipping`,
`notifications`, `analytics`, `search`, `ai`, `billing`, `admin` renvoient tous un
`{ items: [], note: '... scaffolded — implementation pending.' }`. Ils sont correctement
protégés par `authenticate` + `resolveTenant`, mais **vides**.

Les services `worker`, `search` et `notifications` sont également des squelettes : le worker a
des handlers vides avec commentaires, `indexProduct()` **lève une exception** "pending phase 3".
`packages/ui` est un placeholder d'une ligne. `apps/mobile` est un README sans code.

Le service IA Python expose 3 endpoints contractuels qui **retournent des chaînes
placeholder** (`model="placeholder-v0"`), mais les schémas Pydantic sont propres et bien pensés —
la séparation `metrics_used` (mesuré) vs. narration générée est une bonne intuition.

---

## 4. Bugs et risques découverts

C'est la partie la plus importante : **j'ai reproduit chaque point ci-dessous en exécutant l'API.**

### ~~🔴 CRITIQUE #1~~ — ✅ CORRIGÉ — Fuite de données inter-tenants sur l'API storefront publique

Un produit créé **sans `storeId`** (c'est-à-dire par le flux normal `POST /api/products`) est
renvoyé sur **la storefront de toutes les autres boutiques**.

```
[Reproduit] storefront de "beta-store" returns 2 products;
            products belonging to tenant A leaked: 1
            leaked titles: ["alpha Secret Product"]
```

Cause — `services/api/src/modules/products/products.service.ts`, `listStorefrontProducts()` :

```ts
(!p.storeId || p.storeId === storeIdOrSlug || p.tenantId === storeIdOrSlug)
//  ^^^^^^^^^^^ tout produit sans storeId est exposé à N'IMPORTE QUELLE boutique
```

C'est une **violation directe de la règle d'isolation de la spec section 3**, qui est présentée
comme le principe fondateur du projet. Pour une plateforme multi-tenant, c'est le bug le plus
grave possible : il expose le catalogue privé d'un marchand à ses concurrents.

Aggravant : la branche MongoDB de la même fonction utilise un filtre **différent**
(`$or: [{ storeId }, { tenantId }]`). Les deux chemins de persistance ont donc des sémantiques
divergentes — un bug qui n'apparaîtrait qu'en production, une fois Mongo branché.

### ~~🔴 CRITIQUE #2~~ — ✅ CORRIGÉ — Écriture inter-tenants sur les boutiques

`PATCH /api/stores/:id` permet à **n'importe quel marchand authentifié de modifier la boutique
d'un autre marchand**.

```
[Reproduit] tenant B patching tenant A's store -> HTTP 200, name now "HIJACKED BY BETA"
```

Deux causes cumulées :
- la route n'a **aucun `requirePermission`** (contrairement à `products.routes.ts` qui est
  correctement protégé) ;
- `updateStore()` fait `stores.get(storeId)` **sans vérifier le `tenantId`**, et ne retourne
  jamais `undefined` — le `if (!updated) throw 404` de la route est donc **inatteignable**.

### 🟠 ÉLEVÉ #3 — Les données écrites en Mongo ne sont jamais relues sur certains chemins

`GET /api/tenants/:id` et `GET /api/auth/me` lisent **uniquement les `Map` en mémoire**.
Conséquence : après un redémarrage de l'API avec une base Mongo peuplée, `me` répond
`404 User not found` pour un token parfaitement valide (la Map `users` n'est remplie que par
`register`/`login` dans le processus courant), et un tenant ne peut plus être lu par son
propre propriétaire. Le projet écrit en Mongo mais ne lit pas depuis Mongo sur ces routes.

### 🟠 ÉLEVÉ #4 — Les refresh tokens ne sont ni rotés ni révoqués

```
[Reproduit] same refresh token used twice -> 200 then 200
```

Aucun `jti`, aucun store de révocation, aucune détection de réutilisation. Un refresh token volé
reste valide **7 jours pleins** (`JWT_REFRESH_TTL=604800`), et peut être rejoué indéfiniment.
La spec annonce pourtant une rotation.

### 🟠 ÉLEVÉ #5 — Le démarrage rapide documenté dans le README ne fonctionne pas

Le README dit : « Copy `.env.example` to `.env` before starting ». Or :

```
[Reproduit] $ npm run dev -w services/api   (après avoir copié .env)
Error: Missing required environment variable: JWT_ACCESS_SECRET
```

Il n'y a **aucune dépendance `dotenv` dans tout le dépôt**, et `tsx watch` ne charge pas `.env`.
`.env.example` est donc un fichier purement décoratif : il faut exporter les variables à la main.

Aggravant : `loadConfig()` est appelé **au moment de l'import** dans chaque module de routes
(`authenticate(loadConfig().jwt.accessSecret)`). Une variable manquante provoque donc un crash à
l'import (trace dans `auth.routes.ts`) plutôt qu'une erreur de démarrage contrôlée et lisible.
C'est le tout premier contact d'un nouveau développeur avec le projet.

### 🟠 ÉLEVÉ #6 — Le checkout n'a ni stock, ni client, ni idempotence

```
[Reproduit] product stock=1, two checkouts of qty=99 -> HTTP 201 and 201
[Reproduit] same buyer submitted twice -> two distinct orders: true
[Reproduit] tax=0 shipping=0 hardcoded -> total {"amount":9900,"currency":"USD"}
[Reproduit] checkout with paymentProvider=STRIPE -> HTTP 201, payment = undefined
```

- **Aucune validation ni décrémentation du stock.** Les produits reçoivent un `stock: 10` par
  défaut qui n'est **jamais lu**. On peut vendre 99 unités d'un article qui en a 1.
- **Aucune idempotence** : un double-clic crée deux commandes et deux paiements.
- **Taxes et livraison codées en dur à 0**, malgré l'existence du module `shipping` (stub).
- **Aucun enregistrement client** n'est créé, alors que `customers` est un module prévu.
- **`paymentProvider: 'STRIPE'` est accepté par le schéma Zod mais ne crée aucun paiement** :
  la commande est créée et renvoyée en `201` avec `payment: undefined`, donc `PENDING` et
  impayée, sans aucune erreur. Silencieusement incohérent.

### 🟡 MOYEN #7 — Le storefront ne parle jamais à l'API

**Zéro appel `fetch()` dans tout `apps/`.** Le plus beau travail d'interface du dépôt — le
parcours « Open a store » (formulaire multi-étapes, aperçu live, 3 thèmes, 4 outils, slug
automatique) — écrit son brouillon dans `localStorage['mountain-store-draft']`, et les pages
`/store/[slug]` le relisent **côté client**. Le catalogue est **codé en dur** dans
`page.tsx` et `[slug]/page.tsx` (6 boutiques fictives : Ayoub Fashion, Noura Living, …).

Résultat : **les deux moitiés du projet — le backend qui marche et le frontend soigné — ne se
parlent pas.** Créer une boutique depuis l'UI ne crée aucun tenant, aucun produit n'est
affiché depuis l'API, et une boutique « créée » n'existe que dans le navigateur de son auteur.
C'est le plus grand écart entre la promesse perçue et la réalité fonctionnelle.

### 🟡 MOYEN #8 — L'argent est calculé en nombres flottants

`packages/utils` utilise `Number(amount.toFixed(d))` puis additionne/multiplie en IEEE-754.
Pour une plateforme de commerce, la représentation sûre est l'**entier en unité mineure**
(centimes). Les erreurs d'arrondi sur de gros volumes, les splits de remboursement et les
arrondis fiscaux finiront par produire des écarts de caisse. Point positif : `addMoney` protège
contre les mélanges de devises.

### 🟡 MOYEN #9 — Double source de vérité

`createProduct` écrit **à la fois** dans Mongo et dans la `Map` en mémoire. `listProducts` lit
Mongo, `getProduct` lit Mongo puis retombe sur la Map, `listStorefrontProducts` peut lire l'un
ou l'autre. Les erreurs Mongo sont **avalées** (`console.warn`) : un produit peut sembler créé
alors qu'il n'est pas persisté, et disparaître au redémarrage suivant.

À noter aussi : **`orders` et `payments` ne sont jamais persistés** — uniquement des `Map`,
alors que `order.model.ts` et `payment.model.ts` existent déjà. Toutes les commandes sont perdues
au redémarrage.

### 🔵 FAIBLE #10 — Divers

- `docker-compose.yml` : `MINIO_ROOT_USER_PASSWORD` n'est pas une variable MinIO valide
  (l'original est `MINIO_ROOT_PASSWORD`, présent juste en dessous) — ligne parasite.
- MinIO est exposé en `latest` sans tag de version, contrairement à Mongo/Redis/OpenSearch.
- Pas de `.github/` : **aucune CI**, alors que tout est vert en local. Aucun config
  ESLint/Prettier malgré les scripts `lint` déclarés dans les workspaces.
- **Aucun test unitaire** dans le dépôt (pas de `*.test.ts`) — uniquement le smoke test.
- `packages/types` définit une entité `Cart` ; le module `cart` renvoie `[]`.

---

## 5. Architecture — ce qui est bien pensé

- **Séparation `core/` vs `modules/`** claire et constante : le noyau (contexte, erreurs,
  db, redis, middlewares) est indépendant des domaines ; chaque module suit le trio
  `routes / service / schemas`. L'extraction future en microservices est crédible.
- **La chaîne de middlewares est élégante** : `authenticate → resolveTenant → requirePermission`.
  Un domaine protégé se résume à une ligne. C'est un excellent choix de design.
- **L'abstraction provider est exemplaire** : la spec dit « interfaces, jamais de vendeurs
  codés en dur », et le code honore cette promesse.
- **Le RBAC par wildcards** est simple et extensible, sans table de permissions rigide.
- **Le smoke test** est un vrai test d'intégration bout-en-bout, pas un `expect(true)`.
- **`errors.ts`** centralise le formatage, avec `wrap()` pour propager les rejets async —
  propre et idiomatique.

## 6. Faiblesses structurelles de fond

1. **Le pattern « Mongo sinon Map » est la racine de la plupart des bugs.** Il double chaque
   chemin de code sans qu'aucun test ne couvre la variante Mongo, et c'est exactement là que se
   logent les divergences (#1, #3, #9). Une seule source de vérité, avec des repositories
   in-memory réservés aux tests, éliminerait toute cette classe de défauts.

2. **L'isolation multi-tenant est affirmée, pas garantie.** C'est le principe n°1 affiché du
   projet, et c'est pourtant là que se trouvent les deux failles critiques. Il n'existe
   **aucun test d'isolation** : rien n'échouerait si quelqu'un réintroduisait ce bug.

3. **La spec est en avance de plusieurs crans sur le code.** Elle marque la phase 1 (« core »)
   comme ✅, incluant « cart, checkout, dashboards ». Réalité : le panier est un stub, les
   dashboards sont des maquettes, et le checkout n'a ni stock ni idempotence. Le tableau des
   modules de `services/api/README.md` (🟡/⚪) est nettement plus honnête que la spec.

4. **Beaucoup de surface, peu de profondeur.** 14 workspaces, 5 services, 21 modules de routes,
   mais ~2 domaines réellement fonctionnels (produits, commandes) et un socle d'auth solide.
   La largeur du scaffolding est impressionnante ; la densité fonctionnelle ne suit pas encore.

---

## 7. Recommandations priorisées

### P0 — À corriger avant toute autre chose (sécurité / intégrité)

1. ✅ **FAIT — Fermer la fuite storefront (#1)** : filtre strict par `tenantId` (+ `storeId` quand
   il est défini), sémantique unifiée entre branches Mongo et mémoire via
   `isProductVisibleForStore`.
2. ✅ **FAIT — Fermer l'écriture inter-tenants sur les stores (#2)** : `requirePermission` ajouté
   sur la route, et `updateStore()` retourne `undefined` si la boutique appartient à un autre tenant.
3. 🟡 **PARTIEL — Tests d'isolation** : `scripts/verify-tenancy.mjs` existe et couvre le chemin
   mémoire (`npm run test:tenancy`). **Reste à faire** : la CI GitHub Actions qui l'exécute, et
   l'extension au chemin MongoDB (nécessite un Mongo en service dans la CI). Sans ce gate
   automatique, rien n'empêche une régression d'être mergée.

### P1 — Robustesse et développeur

4. **Charger `.env` pour de vrai** (`node --env-file=.env`, ou ajouter `dotenv` ; `tsx` accepte
   `--env-file`) et rendre `loadConfig()` paresseux plutôt qu'à l'import (#5). Le README doit
   marcher du premier coup.
5. **Rotation des refresh tokens** avec store de révocation dans Redis (déjà présent) et
   détection de réutilisation (#4).
6. **Cohérence du checkout** (#6) : vérifier le stock, le décrémenter, créer/mettre à jour le
   client, clé d'idempotence, et **rejeter explicitement** `STRIPE` tant que le provider n'existe
   pas (renvoyer 501 au lieu d'un faux succès).
7. **Rendre les lectures cohérentes** (#3) : lire Mongo quand il est connecté, sur *toutes* les
   routes, y compris `me` et `tenants/:id`.
8. **Persister orders et payments** — les modèles Mongoose existent déjà.

### P2 — Qualité

9. **Représenter l'argent en entier (centimes)** dans `packages/utils`, avec helpers de
   conversion pour l'affichage.
10. **Supprimer le double chemin de persistance** : une seule source de vérité, et des
    repositories in-memory réservés aux tests.
11. **Brancher le storefront sur l'API** (#7) : le parcours « Open a store » doit appeler
    `POST /api/tenants`, et les pages boutique doivent lire `/api/storefront/stores/:slug`.
    C'est ce qui transformera une démo en produit.
12. **CI GitHub Actions** : `npm ci && npm run typecheck && npm run build && node scripts/smoke.mjs`
    + les tests d'isolation. Ajouter ESLint/Prettier (les scripts `lint` existent déjà mais ne
    font rien).
13. Nettoyer `docker-compose.yml` (variable MinIO invalide, tag MinIO).

---

## 8bis. Correctifs appliqués (2026-10-05)

### ✅ Critique #1 — fuite de catalogue inter-tenants : corrigé

**Approche** : plutôt que de rafistoler le filtre, j'ai supprimé la *cause racine* — la duplication
du raisonnement de visibilité entre les deux chemins de persistance.

- `isProductVisibleForStore(product, tenantId, storeId)` est désormais **l'unique source de
  vérité** de la règle de visibilité, et elle est appliquée **à l'identique** aux branches
  MongoDB et mémoire. Un test de non-régression fige sa table de vérité.
- `listStorefrontProducts(tenantId, storeId?)` a une signature **explicite et scopée** : le tenant
  propriétaire est obligatoire, `storeId` ne fait que restreindre. L'ancienne signature acceptait
  un `storeIdOrSlug` ambigu, que le premier appelant utilisait pour passer… un `storeId`, et le
  second un `tenantId`.
- La requête Mongo est passée de `$or: [{storeId}, {tenantId}]` (non scopée) à un filtre
  **`{tenantId, status: 'ACTIVE'}`**, la visibilité étant ensuite appliquée en mémoire.
- Le point d'entrée `/products/:productSlug` applique maintenant le même prédicat, et son filtre
  Mongo exige `tenantId` explicitement.
- **Bonus** : les trois mappers `doc → ProductRecord` dupliqués (dont la divergence *était* le bug)
  sont remplacés par un unique `toProductRecord()`.

**Preuves** — avant / après, même scénario :

| | Avant | Après |
| --- | --- | --- |
| Storefront de B, produits fuités depuis A | **1** | **0** |
| Produit de A via slug direct chez B | 200 | **404** |
| Catalogue légitime de A | 1 | **1** (non régressé) |

### ✅ Critique #2 — écriture inter-tenants sur les boutiques : corrigé

Les deux causes ont été traitées séparément :

- **RBAC manquant** : `requirePermission('stores.update')` sur `PATCH /:id` et
  `requirePermission('stores.read')` sur `GET /`. J'ai ajouté `stores.*` au rôle MANAGER et
  `stores.read` à tous les rôles opérationnels, pour ne pas casser l'accès au dashboard des
  non-propriétaires.
- **Contrôle de tenant absent** : `updateStore()` valide désormais l'appartenance **sur les deux
  chemins** et retourne `undefined` si la boutique est inconnue *ou* appartient à un autre tenant —
  le `if (!updated) throw 404` de la route, jusqu'ici **inatteignable**, fonctionne enfin.
- Le `patch` est reconstruit en **liste blanche** : `tenantId` et `slug` ne sont plus modifiables
  via le body. L'`upsert: true` a été retiré de la branche Mongo (un PATCH ne doit pas créer de
  boutique).

**Preuves** :

| Scénario | Avant | Après |
| --- | --- | --- |
| B patche la boutique de A | **200 + nom changé** | **404**, boutique intacte |
| `tenantId` injecté via le body | accepté | **ignoré**, tenantId inchangé |
| PATCH sur un id inexistant | créait la boutique | **404** |

### 🧪 Garde-fou permanent : `scripts/verify-tenancy.mjs`

Recommandation P0 #3 appliquée : un test d'isolation exécutable, dans le style de
`scripts/smoke.mjs` (aucun framework à installer).

```bash
npm run test:tenancy
```

Il crée deux marchands isolés et vérifie **les deux directions** — l'attaque est bloquée *et* le
chemin légitime fonctionne — sur le catalogue (fuite, slug direct, brouillon jamais public) et sur
les boutiques (hijack, injection de `tenantId`, id inconnu). Il sort en code non-nul sous CI.

**Limite connue** : ce test s'exécute sur le chemin mémoire. Les chemins MongoDB ont été vérifiés
par instrumentation des modèles Mongoose (capture des filtres) : `listStorefrontProducts` filtre
bien `{tenantId, status}`, `getProduct` filtre `{_id, tenantId}`, `updateStore` cherche
`{_id, tenantId}` et **n'émet aucun write** vers une boutique étrangère. Le binaire MongoDB n'est
pas téléchargeable depuis cet environnement, donc ces chemins ne sont pas couverts par un test
bout-en-bout — d'où l'importance de la recommandation CI ci-dessous.

### ✅ Vérifications de non-régression

`npm run typecheck` (12/12 workspaces), `npm run build` (tous), `scripts/smoke.mjs` (17/17) et
`scripts/verify-tenancy.mjs` (13/13) passent tous après correctif.

---

## 8ter. Ce qui reste ouvert

| # | Problème | Sévérité | État |
| --- | --- | --- | --- |
| 1 | Fuite catalogue inter-tenants | 🔴 Critique | ✅ **Corrigé** |
| 2 | Écriture inter-tenants sur les boutiques | 🔴 Critique | ✅ **Corrigé** |
| 3 | `me` / `tenants/:id` ne lisent jamais Mongo | 🟠 Élevé | ❌ Ouvert |
| 4 | Refresh tokens ni rotés ni révoqués | 🟠 Élevé | ❌ Ouvert |
| 5 | `npm run dev` plante (pas de chargement `.env`) | 🟠 Élevé | ❌ Ouvert |
| 6 | Checkout : ni stock, ni idempotence, ni client | 🟠 Élevé | ❌ Ouvert |
| 7 | Storefront décorrélé de l'API | 🟡 Moyen | ❌ Ouvert |
| 8 | Argent en flottants | 🟡 Moyen | ❌ Ouvert |
| 9 | Double source de vérité Mongo/mémoire | 🟡 Moyen | ❌ Ouvert |
| 10 | Divers (CI, lint, MinIO, tests) | 🔵 Faible | ❌ Ouvert |

---

## 9. Verdict

C'est un **scaffolding de très bonne facture et sérieusement exécuté** — typecheck strict vert
sur 12 workspaces, build complet fonctionnel, smoke test end-to-end qui passe, RBAC soigné,
abstraction de paiement exemplaire, machine à états de commandes bien modélisée, frontend
storefront réellement agréable. Le travail de spécification en amont est inhabituel et précieux.

Mais trois réserves empêchent de le considérer comme « phase 1 terminée » :

- **Deux failles d'isolation inter-tenants sont exploitables dès maintenant**, sur le principe
  que le projet présente comme son fondement. C'est le point bloquant absolu.
- **Aucun test autre qu'un smoke test**, et aucune CI — donc rien ne protège les acquis.
- **L'interface la plus aboutie ne parle pas au backend**, ce qui donne une impression de
  complétude que le code ne soutient pas encore.

La bonne nouvelle : le socle est sain et les correctifs sont **ciblés et peu profonds** — les
deux failles critiques se corrigent en quelques lignes chacune. Le projet n'a pas besoin d'être
réécrit ; il a besoin d'être **resserré** : moins de surface, une seule source de vérité, des
tests d'isolation, et le frontend connecté à l'API.
