import { Router } from 'express';
import { loadConfig } from '@mountain/config';
import { authenticate } from '../../core/middleware/authenticate.js';
import { resolveTenant } from '../../core/middleware/resolveTenant.js';

export const notificationsModule = Router();

notificationsModule.use(authenticate(loadConfig().jwt.accessSecret), resolveTenant);

// TODO(phase-2): notification preferences and in-app feed. Delivery itself is
// handled by services/notifications (email/SMS/push workers).
notificationsModule.get('/', (_req, res) => {
  res.json({ items: [], note: 'Notifications module scaffolded — implementation pending.' });
});
