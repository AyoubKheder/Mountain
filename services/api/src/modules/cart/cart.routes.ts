import { Router } from 'express';
import { loadConfig } from '@mountain/config';
import { authenticate } from '../../core/middleware/authenticate.js';
import { resolveTenant } from '../../core/middleware/resolveTenant.js';

export const cartModule = Router();

cartModule.use(authenticate(loadConfig().jwt.accessSecret), resolveTenant);

// TODO(phase-1): guest/auth carts, merge-on-login, coupon application,
// quantity + inventory validation, shipping estimation.
cartModule.get('/', (_req, res) => {
  res.json({ items: [], note: 'Cart module scaffolded — implementation pending.' });
});
