import { Router } from 'express';
import { loadConfig } from '@mountain/config';
import { authenticate } from '../../core/middleware/authenticate.js';
import { resolveTenant } from '../../core/middleware/resolveTenant.js';

export const aiModule = Router();

aiModule.use(authenticate(loadConfig().jwt.accessSecret), resolveTenant);

// TODO(phase-4): AI gateway proxying to services/ai — product descriptions,
// SEO content, store generation, analytics Q&A, marketing copy.
aiModule.post('/generate', (_req, res) => {
  res.status(501).json({
    note: 'AI gateway scaffolded — implement proxy to AI_SERVICE_URL.',
    target: loadConfig().aiServiceUrl,
  });
});
