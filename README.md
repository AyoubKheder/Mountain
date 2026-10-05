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
docker compose up -d        # local Mongo, Redis, OpenSearch, MinIO
npm run dev -w services/api # API on :4000
```

Copy `.env.example` to `.env` before starting. Regenerate the full product spec PDF with `./.venv/Scripts/python.exe generate_spec.py`.
