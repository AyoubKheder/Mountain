import { Router } from 'express';
import { loadConfig } from '@mountain/config';
import { authenticate } from '../../core/middleware/authenticate.js';
import { resolveTenant } from '../../core/middleware/resolveTenant.js';

export const analyticsModule = Router();

analyticsModule.use(authenticate(loadConfig().jwt.accessSecret), resolveTenant);

// TODO(phase-2): revenue, orders, AOV, conversion, traffic and funnel metrics.
// ClickHouse integration lands in phase 3 for high-volume events.
analyticsModule.get('/overview', (_req, res) => {
  res.json({
    note: 'Analytics module scaffolded — implementation pending.',
    metrics: ['revenue', 'orders', 'customers', 'conversionRate', 'averageOrderValue'],
  });
});
