import { Router } from 'express';
import { loadConfig } from '@mountain/config';
import { authenticate } from '../../core/middleware/authenticate.js';
import { resolveTenant } from '../../core/middleware/resolveTenant.js';

export const customersModule = Router();

customersModule.use(authenticate(loadConfig().jwt.accessSecret), resolveTenant);

// TODO(phase-2): customer profiles, addresses, order history, segmentation.
customersModule.get('/', (_req, res) => {
  res.json({ items: [], note: 'Customers module scaffolded — implementation pending.' });
});
