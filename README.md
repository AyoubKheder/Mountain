# Mountain

**Advanced Multi-Tenant E-Commerce SaaS Platform** — one platform, many independent merchants, each with an isolated store, catalog, orders, customers and analytics.

> Full product & technical specification: [`docs/specification.md`](docs/specification.md)

## Structure

| Path | Purpose |
| --- | --- |
| `apps/merchant` | Merchant dashboard (React + TypeScript) |
| `apps/storefront` | Public stores (Next.js) |
| `apps/admin` | Platform admin (React + TypeScript) |
| `apps/mobile` | Flutter mobile apps (merchant + customer) |
| `services/api` | Modular-monolith backend (Node.js + NestJS-style) |
| `services/ai` | Python AI microservice (FastAPI) |
| `services/worker` | Event-driven background jobs |
| `services/search` | OpenSearch indexing service |
| `services/notifications` | Email / SMS / push delivery |

## Quick start

```bash
npm install
cp .env.example .env        # loaded automatically by the API (Node's built-in loader)
docker compose up -d        # local Mongo, Redis, OpenSearch, MinIO
npm run dev -w services/api # API on :4000
```

MongoDB and Redis are optional: the API boots without them and falls back to
in-memory persistence, with `/health/ready` reporting `degraded`.

## Tests

Three executable suites, no test framework required. Each boots the API on a
scratch port and exits non-zero on failure, so they work as CI gates.

```bash
npm run test:smoke      # end-to-end: auth → tenant → product → order → payment → refund
npm run test:tenancy    # multi-tenant isolation (must hold on every change)
npm run test:commerce   # commerce invariants: no overselling, idempotency, server-side pricing
```

## Documentation

| Document | Purpose |
| --- | --- |
| [`docs/specification.md`](docs/specification.md) | Product & technical specification |
| [`docs/analysis.md`](docs/analysis.md) | Code review: what works, what is broken, what is fixed |
| [`docs/shopify-benchmark.md`](docs/shopify-benchmark.md) | Mountain vs Shopify/Medusa/Saleor/Vendure, and the completion plan |

Regenerate the full product spec PDF with `python generate_spec.py`.
