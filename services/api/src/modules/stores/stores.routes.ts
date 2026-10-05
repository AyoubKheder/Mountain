import { Router } from 'express';
import { z } from 'zod';
import { loadConfig } from '@mountain/config';
import { authenticate } from '../../core/middleware/authenticate.js';
import { resolveTenant } from '../../core/middleware/resolveTenant.js';
import { requirePermission } from '../../core/middleware/requirePermission.js';
import { wrap } from '../../core/context.js';
import { ApiError } from '../../core/errors.js';
import { listStores, updateStore } from './stores.service.js';

export const storesModule = Router();

storesModule.use(authenticate(loadConfig().jwt.accessSecret), resolveTenant);

storesModule.get(
  '/',
  requirePermission('stores.read'),
  wrap(async (req, res) => {
    const items = await listStores(req.tenant!.tenantId);
    res.json({ items });
  }),
);

const updateStoreSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(500).optional(),
  defaultCurrency: z.string().length(3).optional(),
  defaultLocale: z.string().max(10).optional(),
  published: z.boolean().optional(),
  themeSettings: z
    .object({
      themeId: z.string().optional(),
      colors: z
        .object({
          background: z.string().optional(),
          accent: z.string().optional(),
          card: z.string().optional(),
          text: z.string().optional(),
        })
        .optional(),
      navigation: z.array(z.object({ label: z.string(), url: z.string() })).optional(),
    })
    .optional(),
  customDomains: z
    .array(
      z.object({
        hostname: z.string().min(3),
        verified: z.boolean().default(false),
        sslActive: z.boolean().default(false),
      }),
    )
    .optional(),
});

storesModule.patch(
  '/:id',
  requirePermission('stores.update'),
  wrap(async (req, res) => {
    const parsed = updateStoreSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid store update payload');
    }
    // Returns undefined for both "missing" and "owned by another tenant", so a
    // merchant cannot distinguish — nor modify — a foreign store.
    const updated = await updateStore(req.tenant!.tenantId, req.params.id!, parsed.data);
    if (!updated) {
      throw new ApiError(404, 'Store not found');
    }
    res.json(updated);
  }),
);
