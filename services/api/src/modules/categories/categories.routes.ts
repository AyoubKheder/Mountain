import { Router } from 'express';
import { loadConfig } from '@mountain/config';
import { authenticate } from '../../core/middleware/authenticate.js';
import { resolveTenant } from '../../core/middleware/resolveTenant.js';

export const categoriesModule = Router();

categoriesModule.use(authenticate(loadConfig().jwt.accessSecret), resolveTenant);

// TODO(phase-1): category CRUD, tree structure, product assignment.
categoriesModule.get('/', (_req, res) => {
  res.json({ items: [], note: 'Categories module scaffolded — implementation pending.' });
});
