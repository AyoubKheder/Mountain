import { Router } from 'express';
import { loadConfig } from '@mountain/config';
import { authenticate } from '../../core/middleware/authenticate.js';
import { resolveTenant } from '../../core/middleware/resolveTenant.js';
import { requirePermission } from '../../core/middleware/requirePermission.js';
import { wrap } from '../../core/context.js';

export const usersModule = Router();

usersModule.use(authenticate(loadConfig().jwt.accessSecret));

usersModule.get(
  '/me',
  wrap(async (req, res) => {
    res.json({ userId: req.auth!.userId, email: req.auth!.email });
  }),
);

usersModule.get(
  '/',
  resolveTenant,
  requirePermission('settings.read'),
  wrap(async (req, res) => {
    // Placeholder — backed by the users collection once persistence lands.
    res.json({ items: [], tenantId: req.tenant!.tenantId });
  }),
);
