import { Router } from 'express';
import { loadConfig } from '@mountain/config';
import { authenticate } from '../../core/middleware/authenticate.js';
import { resolveTenant } from '../../core/middleware/resolveTenant.js';

export const searchModule = Router();

searchModule.use(authenticate(loadConfig().jwt.accessSecret), resolveTenant);

// TODO(phase-3): OpenSearch-backed full-text search, facets, autocomplete,
// typo tolerance, synonyms and ranking.
searchModule.get('/', (_req, res) => {
  res.json({ items: [], note: 'Search module scaffolded — OpenSearch integration pending.' });
});
