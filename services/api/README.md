# @mountain/api

Modular-monolith backend (Express + TypeScript). Domains live in `src/modules/` — each can be extracted into its own service later (spec section 25).

## Modules

| Module | Status |
| --- | --- |
| `auth` | ✅ register / login / refresh / me, bcrypt hashing, JWT via `@mountain/auth` |
| `tenants` | ✅ tenant creation with store provisioning + OWNER membership |
| `products` | ✅ tenant-filtered CRUD with pagination and search |
| `orders` | ✅ creation from line items, totals math, status-machine transitions |
| `payments` | ✅ provider abstraction + mock provider (Stripe pending) |
| `stores` | 🟡 list/get only — themes, pages, domains pending |
| `users`, `categories`, `inventory`, `cart`, `customers`, `reviews`, `discounts`, `shipping`, `notifications`, `analytics`, `search`, `ai`, `billing`, `admin` | ⚪ scaffolded stubs with TODOs per phase |

## Conventions

- **Auth**: `authenticate` → `resolveTenant` → `requirePermission('resource.action')`.
- **Tenancy**: every tenant-owned record carries `tenantId`; every query filters by it (spec section 3).
- **Errors**: throw `ApiError(status, message)`; the central handler formats responses.
- **Storage**: in-memory Maps for the scaffold; swap in Mongoose models per module.
- **Validation**: zod schemas in `*.schemas.ts` next to each module.

## Run

```bash
npm run dev -w @mountain/api   # tsx watch on :4000
```
