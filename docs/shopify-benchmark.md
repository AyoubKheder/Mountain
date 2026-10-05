# Mountain face à Shopify, Medusa, Saleor & Vendure

> Analyse comparative et plan de complétion — 2026-10-05.
> Compagnon de `docs/analysis.md` (état du code) : ce document définit **ce que « complet » veut dire**.

---

## 1. Méthode

J'ai étudié la documentation et les retours d'ingénierie de Shopify (architecture, Storefront API,
Polaris), et comparé trois plateformes open-source de référence — **Medusa** (Node/TS, modulaire),
**Saleor** (Python/Django, GraphQL-first), **Vendure** (NestJS/TS, plugins) — plus les grilles de
fonctionnalités attendues d'une plateforme e-commerce (checkout, stocks, OMS).

L'objectif n'est pas de copier Shopify, mais d'en extraire les **invariants techniques** qu'une
plateforme de commerce doit respecter, puis de mesurer l'écart.

---

## 2. Ce que Shopify fait, et pourquoi

### 2.1 Multi-tenant : schéma partagé + `tenant_id`

Shopify sert des centaines de milliers de boutiques depuis une même plateforme. Chaque boutique est
un **tenant** : produits, commandes, clients, thèmes et réglages sont totalement isolés, mais le
code est commun. Le modèle dominant est *shared database, shared schema* : une colonne `tenant_id`
sur chaque table, et **chaque requête doit inclure un `WHERE tenant_id`**.

👉 **Mountain fait déjà ça** (`tenantId` sur chaque entité + `resolveTenant`). C'est le bon choix
d'architecture — et c'est précisément pourquoi les deux failles critiques trouvées dans l'analyse
étaient graves : elles violaient l'invariant central du modèle.

### 2.2 Trois API distinctes, trois publics

| API | Public | Contenu |
| --- | --- | --- |
| **Storefront API** | L'acheteur (public) | Catalogue, recherche, panier, checkout |
| **Admin API** | Le marchand (authentifié) | Produits, stocks, commandes, remises, webhooks |
| **Customer Account API** | Le client final | Profil, commandes, adresses, retours |

👉 Mountain a les trois surfaces (`/api/storefront` public, `/api/*` marchand, et… pas de surface
client final). **Manque : un espace client.**

### 2.3 Le panier est un objet de première classe

C'est l'enseignement le plus important. Depuis la dépréciation de l'ancienne *Checkout API*
(avril 2025), Shopify fonctionne avec la **Cart API** :

```
créer un panier → cartLinesAdd / cartLinesUpdate / cartLinesRemove
                → cartDiscountCodesUpdate / cartBuyerIdentityUpdate
                → redirection vers cart.checkoutUrl
```

Le panier est un **objet mutable persistant**, avec un identifiant propre, une identité acheteur et
des remises — il survit à la session et se reconstruit sur un autre appareil. Le *checkout* est une
étape distincte, côté Shopify, qui n'est pas gérée par le front.

👉 Mountain **n'a pas de panier** : son checkout part directement d'une liste d'articles. C'est le
fossé le plus structurant avec le modèle de référence — sans panier, pas d'identité acheteur, pas de
remises appliquées au panier, pas de relance de panier abandonné, pas de panier persistant.

### 2.4 Décomposition en services

Les questions d'architecture de Shopify décrivent invariablement la même découpe :
**catalog · cart · checkout · inventory · order**, plus passerelle API, cache/CDN, recherche,
événements asynchrones, files de jobs et *webhooks*. Les invariants cités comme difficiles :

- **correction du stock sous concurrence** (ne pas survendre pendant un pic) ;
- **idempotence du checkout** ;
- **idempotence des webhooks** de paiement (Stripe réessaie !) ;
- cohérence du panier entre appareils ;
- livraison de webhooks à l'échelle.

👉 Mountain a catalog / order (et checkout), mais **inventory est un stub** et cart n'existe pas.
Ce sont exactement les deux briques qui portent les invariants difficiles.

### 2.5 Paiements : derrière une frontière, jamais dans le cœur

Shopify délègue à Shopify Payments / passerelles. Medusa a des **modules** de paiement
(`@medusajs/payment-stripe`), Saleor des **apps** avec contrat de webhook, Vendure des **plugins**.

👉 Mountain a déjà la bonne abstraction (`PaymentProvider` + factory + mock). **Bien joué** — il
manque l'implémentation Stripe.

### 2.6 Conception de l'admin : Polaris

Polaris est un design system **pour outils marchands** : pas de storytelling, mais des *IndexTable*
et *ResourceList* pour gérer de grands volumes, des états vides et d'états d'erreur soignés, des
actions groupées asynchrones, la densité d'information, l'accessibilité WCAG 2.1 AA.

👉 Les dashboards Mountain sont des maquettes statiques. Il n'y a **aucune** de ces préoccupations.

---

## 3. Ce que font Medusa, Saleor et Vendure

| | Medusa | Saleor | Vendure | **Mountain** |
| --- | --- | --- | --- | --- |
| Langage | TypeScript/Node | Python/Django | TypeScript/NestJS | TypeScript/Node |
| API | REST + SDK | GraphQL | GraphQL (Shop/Admin) | REST |
| Architecture | Modules remplaçables | Monolithe + apps | Plugins | Monolithe modulaire |
| Multi-canal | ✅ | ✅ (cœur) | ✅ (channels) | ❌ |
| Multi-entrepôt | ✅ | ✅ | ✅ (StockLocation) | ❌ |
| Tarifs par région | ✅ (price lists) | ✅ | ✅ | ❌ (devise unique) |
| Paiements | Modules | Apps | Plugins | 🟡 abstraction seule |
| Workflows | ✅ (v2) | Webhooks | Event bus | 🟡 worker squelette |
| Admin UI | ✅ React | ✅ React | ✅ Angular | ❌ maquette |
| Storefront officiel | Next.js | Next.js | Remix/Next | 🟡 décorrélé de l'API |
| TypeScript bout-en-bout | ✅ | ❌ | ✅ | ✅ |

**Enseignement** : les trois plateformes matures convergent sur (a) des **canaux/régions** comme
entité de premier ordre, (b) le **multi-entrepôt**, (c) une **frontière d'extension** (module,
app, plugin) pour le paiement, (d) un **storefront officiel** connecté à l'API, (e) un **admin UI
complet**. Mountain doit viser (a) légèrement, (b) plus tard, (c) déjà fait, (d) et (e) en priorité.

---

## 4. Matrice de capacités — où en est Mountain

Légende : ✅ fait · 🟡 partiel · ❌ manquant

### Socle plateforme
| Capacité | État | Détail |
| --- | --- | --- |
| Multi-tenant + isolation | ✅ | corrigé et testé (`npm run test:tenancy`) |
| Authentification JWT | ✅ | bcrypt, access/refresh |
| Rotation des refresh tokens | 🟡 | bientôt corrigé (rejeu possible aujourd'hui) |
| RBAC granulaire | ✅ | wildcards, 14 rôles |
| Événements / webhooks | 🟡 | worker squelette, pas de transport |
| Observabilité | ❌ | logs `console` uniquement |
| CI / tests automatisés | ❌ | smoke + tenancy manuels |

### Commerce — le cœur
| Capacité | État | Détail |
| --- | --- | --- |
| Catalogue produits / variantes | ✅ | CRUD, variantes, médias, SEO |
| Catégories / collections | ❌ | stub |
| **Stock / inventaire** | ❌ | **stub — aucune validation, on peut survendre** |
| Formule disponible = stock − réservé | 🟡 | présente dans `@mountain/utils`, jamais utilisée |
| **Panier** | ❌ | **stub — le checkout part d'une liste d'articles** |
| Checkout invité | 🟡 | existe, mais non idempotent et sans stock |
| Taxes | ❌ | codées en dur à 0 |
| Livraison / transporteurs | ❌ | stub |
| Remises / coupons | ❌ | stub |
| Commandes + machine à états | ✅ | 9 statuts, transitions validées |
| Persistance des commandes | ❌ | mémoire vive — perdues au redémarrage |
| Clients / comptes | ❌ | stub, aucune surface client |
| Avis / UGC | ❌ | stub |
| Paiement réel (Stripe) | ❌ | abstraction prête, provider mock seulement |
| Remboursements | 🟡 | via mock uniquement |

### Expérience
| Capacité | État |
| --- | --- |
| Storefront connecté à l'API | ❌ (catalogue codé en dur, `localStorage`) |
| Dashboard marchand | ❌ (maquette) |
| Console admin plateforme | ❌ (maquette) |
| Thèmes / éditeur de pages | ❌ |
| Domaines personnalisés | 🟡 (modèle, pas de vérification DNS) |
| Recherche | ❌ (mapping OpenSearch seulement) |
| Notifications e-mail/SMS/push | ❌ |
| Analytics | ❌ |
| Mobile | ❌ |
| Facturation / abonnements | ❌ (catalogue de plans seulement) |
| IA | ❌ (endpoints contractuels, placeholders) |

---

## 5. Les quatre invariants du commerce

Ce sont les points sur lesquels les sources convergent comme étant *les* problèmes difficiles du
commerce en ligne. Ils étaient nos quatre trous ; ils sont maintenant tenus **et vérifiés par un
test** — la colonne « Preuve » donne la commande qui échoue si l'invariant casse.

### 5.1 Ne jamais survendre

Vendre un article sans stock est le bug le plus coûteux d'une boutique. Deux stratégies correctes :

- **décrément conditionnel atomique** — la valeur doit être calculée *au moment de l'écriture*,
  jamais à partir d'une lecture antérieure gardée en variable ;
- **réservations avec TTL** — on incrémente `réservé`, le paiement convertit (`stock` −= 1,
  `réservé` −= 1), l'expiration ou l'échec libère. La contrainte `réservé ≤ stock` est le dernier
  rempart. Pour un panier multi-lignes, la réservation est **tout ou rien** dans une transaction.

**État Mountain** : `available = stock − réservé`. Le hold est pris par une mise à jour
conditionnelle atomique (`$expr: { $gte: [{ $subtract: ['$stock','$reserved'] }, qty] }`) — le test et
l'écriture sont une seule opération, donc deux checkouts simultanés du dernier exemplaire ne peuvent
pas réussir tous les deux. Réservation multi-lignes **tout ou rien**, verrous acquis dans un ordre
déterministe, libération complète en cas d'échec. TTL de 15 min (7 jours en paiement à la livraison)
avec balayage périodique qui rend le stock **et** ferme la commande abandonnée.

*Preuve* : `npm run test:commerce` (« two simultaneous checkouts of the last unit: exactly one
wins », « a refused checkout leaves no order »), `npm run test:reservations` (TTL → stock rendu →
commande annulée).

### 5.2 Idempotence

Un double-clic, un retry réseau ou un webhook rejoué (Stripe réessaie) ne doit **pas** créer deux
commandes ni décrémenter deux fois. La parade standard est la **clé d'idempotence** fournie par le
client, mémorisée avec la réponse.

**État Mountain** : l'en-tête `Idempotency-Key` est mémorisé avec la réponse ; rejouer la même clé
renvoie le **même** `orderId` et le même paiement (`replayed: true`) au lieu de vendre deux fois. Les
webhooks sont idempotents par construction : commit et release sont indexés par `orderId` et ne font
rien s'ils ont déjà été appliqués.

*Preuve* : `npm run test:commerce` (« retry replays instead of reselling », « a replayed retry does
not decrement stock twice »).

### 5.3 Le panier est persistant

Un panier qui disparaît avec la session perd du chiffre d'affaires. Il doit survivre au rechargement,
se retrouver sur un autre appareil, et fusionner à la connexion.

**État Mountain** : le panier est un objet serveur, identifié par son `id` — l'`id` *est* la
capacité, aucun jeton marchand n'est nécessaire côté acheteur. Il survit au rechargement, il est
borné par le stock réel à chaque écriture, il expire au bout de 30 jours et se réclame
(`POST …/claim`) quand l'acheteur s'authentifie.

*Preuve* : `npm run test:commerce`, bloc « Panier persistant » — création anonyme, refus au-delà du
stock, rechargement, totaux, checkout depuis le panier, panier consommé, réclamation idempotente.

### 5.4 Le client est une entité

Sans enregistrement client, pas d'historique de commandes, pas de relance de panier abandonné, pas
de segmentation, pas de fidélité — c'est-à-dire pas de rétention.

**État Mountain** : le client est créé (ou retrouvé par e-mail) au checkout, avec adresse,
historique de commandes et LTV dans `modules/customers`.

*Preuve* : `npm run test:commerce` (historique alimenté par le checkout, LTV servie par l'API).

---

## 6. Définition de « complet »

« Terminer le projet » n'a de sens qu'en niveaux. Je propose cette échelle, calquée sur ce que
délivrent réellement les plateformes étudiées :

| Niveau | Nom | Contenu | Mountain aujourd'hui |
| --- | --- | --- | --- |
| **L1** | **Boutique qui vend** | Catalogue · stock · panier · checkout idempotent · paiement · commande · client | ✅ **Atteint** (voir §7) |
| **L2** | **Plateforme marchande** | L1 + thèmes · domaines · livraison · taxes · remises · avis · notifications · analytics · admin plateforme · facturation | ❌ ~5 % |
| **L3** | **Échelle** | L2 + recherche · événements/webhooks · multi-entrepôt · multi-devise · CI/CD · observabilité | ❌ ~5 % |
| **L4** | **IA & canaux** | L3 + génération de contenu · assistant analytics · recommandations · prévisions · mobile · canaux agentiques | ❌ ~2 % |

**La spec du dépôt annonce L1 comme terminé. C'est faux** — d'où l'impression de complétude que le
code ne soutient pas. Le premier objectif honnête est donc **atteindre L1 réellement**.

> Note sur les « canaux agentiques » : Shopify pousse désormais la découverte de produits par les
> assistants IA (ChatGPT, Gemini, Copilot) comme un canal de vente à part entière. Le pendant
> technique est le *Universal Commerce Protocol* : identifiants produits canoniques, endpoints de
> découverte normalisés, sémantique de réservation avec TTL, idempotence des écritures de panier.
> **C'est exactement l'architecture L1 décrite ci-dessus** — bien construire L1 prépare L4.

---

## 7. Plan de complétion

### 🎯 Track A — « Boutique qui vend » (L1)

| # | Chantier | État | Détail |
| --- | --- | --- | --- |
| A1 | **Inventaire** : stock par variante, réservations TTL, décrément atomique, disponible = stock − réservé, alertes de stock bas | ✅ **Fait** | `modules/inventory` — hold tout-ou-rien, commit/release idempotents, `GET /api/inventory/low-stock` |
| A2 | **Checkout durci** : réservation tout-ou-rien, clé d'idempotence, création client, refus explicite des providers non implémentés, taxes/livraison configurables | ✅ **Fait** | `modules/checkout` — `Idempotency-Key`, réservation avant création, 501 sur STRIPE |
| A3 | **Panier** : objet persistant, lignes add/update/remove, identité acheteur, fusion à la connexion, validation du stock | ✅ **Fait** | `modules/cart` + `modules/storefront/cart.routes.ts` — panier serveur identifié par son `id`, TTL 30 j, validation du stock au niveau de la ligne, `claim` à la connexion (idempotent) |
| A4 | **Clients** : enregistrement, adresses, historique de commandes | ✅ **Fait** | `modules/customers` — upsert par e-mail, historique, LTV |
| A5 | **Persistance** : commandes et paiements en Mongo, lectures cohérentes | ✅ **Fait** | Commandes, clients, inventaire **et paiements** persistés (`payment.model.ts` branché) ; providers choisis par configuration |
| A6 | **Corrections restantes** de l'analyse (#3, #4, #5) | ✅ **Fait** | Lectures Mongo, rotation + révocation des refresh tokens, chargement `.env` |

**Preuves** : `npm run test:commerce` vérifie les invariants du §5 sur le chemin HTTP réel —

```
✓ checkout above available stock is refused              → HTTP 409
✓ a refused checkout creates no order                    → 0 order(s)
✓ two simultaneous checkouts of the last unit: exactly one wins
✓ retry replays instead of reselling                     → HTTP 200, same orderId
✓ a replayed retry does not decrement stock twice
✓ stock decremented on payment                           → 10 → 8
✓ an unimplemented provider is refused loudly            → HTTP 501
✓ COD holds stock without consuming it                   → 5 → 3 available, 5 on hand
✓ cancelling releases the held stock                     → back to 5
✓ tax/shipping come from store settings, client ignored
```

### 🎯 Track A bis — finir L1 (terminé)

Les cinq chantiers qui séparaient Mountain d'une boutique qui vend réellement :

| # | Chantier | État | Ce qui a été fait |
| --- | --- | --- | --- |
| A3 | **Panier** | ✅ | Panier serveur (`modules/cart` + routes storefront) : lignes, quantités bornées par le stock réel, TTL 30 jours, `claim` à la connexion, `quantity: 0` retire la ligne |
| A5 | **Paiements persistés** | ✅ | `payment.model.ts` branché : chaque tentative est écrite en Mongo, `clientSecret` transmis au navigateur, statut relu depuis la base |
| A1′ | **Expiration des réservations** | ✅ | `reservation.sweeper.ts` : balayage périodique (`RESERVATION_SWEEP_INTERVAL_MS`, 60 s par défaut) qui libère les holds expirés **et** ferme les commandes orphelines |
| A2′ | **Provider Stripe réel** | ✅ | `stripe.provider.ts` (REST, sans SDK) + webhook signé `POST /api/payments/webhooks/stripe` ; Stripe n'est enregistré que si `STRIPE_SECRET_KEY` est présent |
| A2″ | **Storefront branché** | ✅ | Marketplace, fiche boutique, fiche produit, panier et checkout lus/écrits via l'API (`/api/**` proxifié par Next) ; « Open a store » crée un vrai marchand |

**Un bug réel corrigé au passage** : la libération opportuniste des holds (déclenchée par une lecture
d'inventaire) rendait le stock **sans** fermer la commande — une commande impayée restait `PENDING`
pour toujours. Stock et état de commande sont désormais mis à jour dans la même passe, quel que soit
le déclencheur (route ou planificateur).

**Preuves ajoutées** : `npm run test:commerce` couvre le panier (création anonyme, bornage par le
stock, persistance après rechargement, checkout depuis le panier, panier consommé, réclamation
idempotente) et `npm run test:reservations` prouve l'expiration de bout en bout :

```
✓ cash-on-delivery order placed
✓ stock is held while the order waits for payment (2 reserved)
✓ expired hold was released automatically (reserved back to 0)
✓ the units are sellable again (available back to 3)
✓ stock was not decremented — nothing was sold
✓ the abandoned order was cancelled by the sweeper
✓ the timeline explains why
✓ sweeping again is idempotent (still 3 available, 0 reserved)
✓ the released units can now be bought (3 added to a cart)
```

### 🎯 Track B — « Plateforme marchande » (L2)

Thèmes + éditeur de pages · domaines personnalisés avec vérification · zones et tarifs de livraison ·
moteur de taxes · remises et coupons · avis modérés · notifications e-mail/SMS/push réelles ·
analytics marchand · console admin plateforme (merchants, abonnements, support, sécurité) ·
facturation et cycle de vie des abonnements · **Stripe réel**.

### 🎯 Track C — « Échelle » (L3)

Recherche OpenSearch réelle · transport d'événements (Kafka/RabbitMQ ou Redis Streams) ·
webhooks sortants avec réessais et signature · multi-entrepôt · multi-devise et tarifs par région ·
CI GitHub Actions (typecheck + build + smoke + tenancy + tests Mongo) · métriques et traces.

### 🎯 Track D — « IA & canaux » (L4)

Génération de produits et de thèmes · assistant analytics branché sur les vraies données ·
recommandations · prévisions de stock · applications mobiles · canaux agentiques (UCP).

### Fil conducteur : le storefront

À chaque track, **le storefront doit rester connecté à l'API** — c'est ce qui transforme la
démonstration en produit.

C'est désormais le cas : plus rien n'est codé en dur ni stocké dans `localStorage`.

| Écran | Source | Écriture |
| --- | --- | --- |
| Marketplace `/` | `GET /api/storefront/stores` | — |
| Boutique `/store/[slug]` | `GET /api/storefront/stores/:slug` + `/products` | panier |
| Produit `/store/[slug]/product/[productSlug]` | `GET …/products/:productSlug` | panier |
| Panier `/store/[slug]/cart` | routes panier + checkout | commande |
| Ouverture de boutique `/open-store` | — | `POST /api/auth/register` → `POST /api/tenants` → `PATCH /api/stores/:id` |

Le navigateur n'appelle jamais l'API en direct (elle n'est pas sur sa machine) : les composants
client utilisent des URL relatives `/api/**`, proxifiées côté serveur Next vers `API_URL`.

**Reste ouvert pour L2+** : le thème choisi à l'ouverture de boutique est stocké et restitué
(couleurs sur la fiche boutique), mais il n'y a pas encore d'éditeur de thème.

---

## 8. Ce que Mountain fait déjà mieux que ses pairs

Il serait injuste de ne lister que les manques :

- **Spécification écrite avant le code.** Rare à ce niveau de détail, et c'est un vrai atout de
  pilotage — à condition de la tenir à jour (elle annonce L1 terminé, ce qui n'est pas vrai).
- **RBAC par wildcards** plus souple que la table de permissions rigide de nombreux concurrents.
- **Abstraction `PaymentProvider`** conforme au modèle module/app/plugin des plateformes matures.
- **Machine à états de commandes** à 9 statuts avec transitions validées — que beaucoup de
  plateformes naïves n'ont pas.
- **Monolithe modulaire** découpé en `routes / service / schemas` par domaine : l'extraction future
  en services est crédible et peu coûteuse.
- **TypeScript strict** vert sur tous les workspaces.

---

## 9. Sources

- Shopify Enterprise — architecture composable et primitives d'abonnement : https://www.shopify.com/enterprise/blog/composable-subscriptions-shopify
- Multi-tenant Shopify apps (shared schema + `tenant_id`, isolation, sécurité) : https://eseospace.com/blog/building-multi-tenant-shopify-apps/
- Architecture système Shopify (catalog/cart/checkout/inventory/order, idempotence, inventaire sous concurrence) : https://www.systemdesignhandbook.com/guides/shopify-system-design-interview/
- Storefront API & Cart API (mutation `cartCreate`, `checkoutUrl`, dépréciation de la Checkout API) : https://www.f22labs.com/blogs/shopify-storefront-graphql/
- Cycle de vie Checkout → Cart API : https://www.blackbeltcommerce.com/shopify-create-checkout/
- Prévention du survente (décrément atomique, réservations, TTL, idempotence des webhooks) : https://dev.to/iurii_rogulia/preventing-overselling-inventory-locks-under-concurrent-checkouts-3m7e
- Validation et réservation d'inventaire (all-ou-rien, timeouts, rollback) : https://dev.walleypay.com/docs/checkout/common-use-cases/inventory-validation/
- Exigences d'inventaire pour canaux agentiques (réservations TTL, clés d'idempotence) : https://wearepresta.com/the-ultimate-woocommerce-ucp-checklist/
- Comparatif Medusa / Saleor / Vendure : https://www.pkgpulse.com/guides/medusa-vs-saleor-vs-vendure-headless-ecommerce-2026
- Panorama des plateformes headless : https://blog.openreplay.com/5-open-source-ecommerce-platforms/
- Shopify Polaris (design system marchand, IndexTable, accessibilité, états vides) : https://ecommerce.folio3.com/blog/what-is-shopify-polaris/
- Attentes fonctionnelles panier/checkout/OMS : https://devtrios.com/blog/ecommerce-app-features/
- Bonnes pratiques de panier (coût complet, panier persistant, checkout invité) : https://belvg.com/blog/best-practices-for-ecommerce-shopping-carts.html
