import { Router } from 'express';
import { loadConfig } from '@mountain/config';
import { authenticate } from '../../core/middleware/authenticate.js';
import { resolveTenant } from '../../core/middleware/resolveTenant.js';
import { PLANS } from '@mountain/config';

export const billingModule = Router();

billingModule.use(authenticate(loadConfig().jwt.accessSecret), resolveTenant);

// Plan catalog is already available; subscription lifecycle is TODO(phase-2).
billingModule.get('/plans', (_req, res) => {
  res.json({ plans: PLANS });
});

// TODO(phase-2): subscription create/upgrade/downgrade, invoices, dunning.
billingModule.get('/subscription', (_req, res) => {
  res.json({ note: 'Billing module scaffolded — subscription lifecycle pending.' });
});
