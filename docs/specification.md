# Mountain — Product & Technical Specification

> Generated from `generate_spec.py` (see the 19-page PDF in `output/`). This file mirrors the architecture sections for quick reference.

## Product vision

Mountain is a multi-tenant SaaS platform inspired by the store-building model of Shopify. One platform serves many independent merchants, while each merchant receives an isolated store, catalog, customers, orders, inventory, settings and analytics.

## Applications

- **Mountain Merchant** — merchant dashboard: products, orders, customers, discounts, analytics, AI tools, employees, billing
- **Mountain Storefront** — one public store per merchant: catalog, search, cart, checkout, customer accounts
- **Mountain Admin** — platform command center: merchants, subscriptions, support, security, AI usage

## Core principles

1. **Multi-tenancy first.** Every tenant-owned record carries `tenantId`; queries resolve and validate the active tenant (see `services/api/src/core/middleware/resolveTenant.ts`).
2. **RBAC everywhere.** Granular `resource.action` permissions via `@mountain/auth` (`hasPermission`, wildcard support).
3. **Provider abstractions.** Payments (and later shipping/AI) are interfaces, never hardcoded vendors.
4. **Modular monolith.** Domains in `services/api/src/modules/*` can be extracted into services as load grows.
5. **Event-driven backbone.** Domain events (`OrderCreated`, `PaymentCompleted`, …) decouple async work.
6. **Build a platform, not a website.**

## Technology stack

| Layer | Technology |
| --- | --- |
| Merchant Web | React + TypeScript (Vite) |
| Storefront | Next.js |
| Admin | React + TypeScript (Vite) |
| Backend | Node.js + TypeScript (Express, NestJS-ready) |
| Database | MongoDB (Mongoose wired, in-memory Maps in scaffold) |
| Cache | Redis |
| Search | OpenSearch |
| Queue/Eventing | Kafka or RabbitMQ (phase 3) |
| Storage | S3-compatible (MinIO locally) |
| Payments | Stripe + local providers (mock provider now) |
| AI | Python + FastAPI |
| Mobile | Flutter (phase 3) |

## Repository layout

```
mountain/
├── apps/            merchant · storefront · admin · mobile
├── services/        api · ai · worker · search · notifications
├── packages/        ui · types · config · auth · utils
├── infrastructure/  docker · kubernetes · terraform
└── docs/
```

## Phased roadmap

1. **Core** — auth ✅, multi-tenancy ✅, store creation ✅, products ✅, cart, checkout, orders ✅, dashboards
2. **Professional** — themes, page builder, custom domains, payments (Stripe), shipping, inventory, coupons, reviews, analytics, notifications
3. **Advanced** — search, recommendations, multi-warehouse, subscriptions, mobile apps, event-driven architecture, advanced analytics
4. **AI** — AI Store Builder, product generator, SEO, analytics assistant, recommendations, marketing, forecasting

Module-level TODOs in the code reference the phase that owns them.
