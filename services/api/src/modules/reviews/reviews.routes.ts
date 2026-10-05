import { Router } from 'express';
import { loadConfig } from '@mountain/config';
import { authenticate } from '../../core/middleware/authenticate.js';
import { resolveTenant } from '../../core/middleware/resolveTenant.js';

export const reviewsModule = Router();

reviewsModule.use(authenticate(loadConfig().jwt.accessSecret), resolveTenant);

// TODO(phase-2): reviews with moderation states PENDING/APPROVED/REJECTED/REPORTED,
// verified-purchase flag, helpful votes, merchant responses.
reviewsModule.get('/', (_req, res) => {
  res.json({ items: [], note: 'Reviews module scaffolded — implementation pending.' });
});
