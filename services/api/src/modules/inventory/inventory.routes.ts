import { Router } from 'express';
import { loadConfig } from '@mountain/config';
import { authenticate } from '../../core/middleware/authenticate.js';
import { resolveTenant } from '../../core/middleware/resolveTenant.js';

export const inventoryModule = Router();

inventoryModule.use(authenticate(loadConfig().jwt.accessSecret), resolveTenant);

// TODO(phase-1): stock levels, reservations, warehouses, low-stock alerts.
// Availability formula: available = stock - reserved (see @mountain/utils).
inventoryModule.get('/', (_req, res) => {
  res.json({ items: [], note: 'Inventory module scaffolded — implementation pending.' });
});
