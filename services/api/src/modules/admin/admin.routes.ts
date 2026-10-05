import { Router } from 'express';
import { loadConfig } from '@mountain/config';
import { authenticate } from '../../core/middleware/authenticate.js';
import { requirePermission } from '../../core/middleware/requirePermission.js';

export const adminModule = Router();

adminModule.use(authenticate(loadConfig().jwt.accessSecret));

// Platform-admin only endpoints (spec section 34 — Admin Command Center).
adminModule.use(requirePermission('platform.admin'));

// TODO(phase-2): merchant management, platform revenue, support tickets,
// fraud monitoring, AI usage/cost dashboards.
adminModule.get('/overview', (_req, res) => {
  res.json({ note: 'Admin module scaffolded — command center pending.' });
});
