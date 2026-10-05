import { Router } from 'express';
import { loadConfig } from '@mountain/config';
import { authenticate } from '../../core/middleware/authenticate.js';
import { resolveTenant } from '../../core/middleware/resolveTenant.js';

export const shippingModule = Router();

shippingModule.use(authenticate(loadConfig().jwt.accessSecret), resolveTenant);

// TODO(phase-2): shipping zones, rates, carriers, shipment tracking.
shippingModule.get('/', (_req, res) => {
  res.json({ items: [], note: 'Shipping module scaffolded — implementation pending.' });
});
