import { Router } from 'express';
import { loadConfig } from '@mountain/config';
import { authenticate } from '../../core/middleware/authenticate.js';
import { resolveTenant } from '../../core/middleware/resolveTenant.js';

export const discountsModule = Router();

discountsModule.use(authenticate(loadConfig().jwt.accessSecret), resolveTenant);

// TODO(phase-2): coupon codes, automatic discounts, flash sales, bundles,
// free shipping, buy-X-get-Y rules.
discountsModule.get('/', (_req, res) => {
  res.json({ items: [], note: 'Discounts module scaffolded — implementation pending.' });
});
