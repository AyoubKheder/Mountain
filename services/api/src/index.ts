/**
 * Mountain API — modular monolith entrypoint.
 */

// Must stay the first import: it loads `.env` before the route modules below
// read configuration at import time.
import './env.js';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { loadConfig } from '@mountain/config';
import { authModule } from './modules/auth/auth.routes.js';
import { tenantsModule } from './modules/tenants/tenants.routes.js';
import { usersModule } from './modules/users/users.routes.js';
import { storesModule } from './modules/stores/stores.routes.js';
import { productsModule } from './modules/products/products.routes.js';
import { categoriesModule } from './modules/categories/categories.routes.js';
import { inventoryModule } from './modules/inventory/inventory.routes.js';
import { startReservationSweeper } from './modules/inventory/reservation.sweeper.js';
import { ordersModule } from './modules/orders/orders.routes.js';
import { customersModule } from './modules/customers/customers.routes.js';
import { cartModule } from './modules/cart/cart.routes.js';
import { paymentsModule } from './modules/payments/payments.routes.js';
import { reviewsModule } from './modules/reviews/reviews.routes.js';
import { discountsModule } from './modules/discounts/discounts.routes.js';
import { shippingModule } from './modules/shipping/shipping.routes.js';
import { notificationsModule } from './modules/notifications/notifications.routes.js';
import { analyticsModule } from './modules/analytics/analytics.routes.js';
import { searchModule } from './modules/search/search.routes.js';
import { aiModule } from './modules/ai/ai.routes.js';
import { billingModule } from './modules/billing/billing.routes.js';
import { adminModule } from './modules/admin/admin.routes.js';
import { storefrontModule } from './modules/storefront/storefront.routes.js';
import { storefrontCartModule } from './modules/storefront/cart.routes.js';
import { errorHandler, notFoundHandler } from './core/errors.js';
import { healthRouter } from './core/health.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  // Stripe signs the raw request body, so the webhook must receive unparsed
  // bytes. Mounted before the JSON parser, which would otherwise consume them.
  app.use('/api/payments/webhooks', express.raw({ type: 'application/json' }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'mountain-api' });
  });
  app.use('/health', healthRouter);

  app.use('/api/auth', authModule);
  app.use('/api/tenants', tenantsModule);
  app.use('/api/users', usersModule);
  app.use('/api/stores', storesModule);
  app.use('/api/products', productsModule);
  app.use('/api/categories', categoriesModule);
  app.use('/api/inventory', inventoryModule);
  app.use('/api/orders', ordersModule);
  app.use('/api/customers', customersModule);
  app.use('/api/cart', cartModule);
  app.use('/api/payments', paymentsModule);
  app.use('/api/reviews', reviewsModule);
  app.use('/api/discounts', discountsModule);
  app.use('/api/shipping', shippingModule);
  app.use('/api/notifications', notificationsModule);
  app.use('/api/analytics', analyticsModule);
  app.use('/api/search', searchModule);
  app.use('/api/ai', aiModule);
  app.use('/api/billing', billingModule);
  app.use('/api/admin', adminModule);
  app.use('/api/storefront', storefrontModule);
  app.use('/api/storefront', storefrontCartModule);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

async function main(): Promise<void> {
  const config = loadConfig();

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`[mountain-api] listening on :${config.port} (${config.env})`);
  });

  // A stock hold that nobody ever releases is a permanent stock loss, so the
  // expiry sweep runs for the lifetime of the process rather than being tied to
  // a request. Idempotent and failure-tolerant; see reservation.sweeper.ts.
  startReservationSweeper();

  // Connect to dependencies after listening so the service reports degraded
  // health instead of failing to boot (e.g. transient DB outages).
  const { connectMongo } = await import('./core/db.js');
  try {
    await connectMongo(config.mongoUri);
    console.log('[mountain-api] connected to MongoDB');
  } catch (err) {
    console.warn(
      `[mountain-api] MongoDB connection failed (${(err as Error).message}); running with in-memory persistence fallback.`,
    );
  }
}

main().catch((err) => {
  console.error('[mountain-api] fatal startup error', err);
  process.exit(1);
});
