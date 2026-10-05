import { Router } from 'express';
import { z } from 'zod';
import { loadConfig } from '@mountain/config';
import { permissionsForRole } from '@mountain/auth';
import { authenticate } from '../../core/middleware/authenticate.js';
import { ApiError } from '../../core/errors.js';
import { wrap } from '../../core/context.js';
import { assignTenantMembership, users, createTokenPair } from '../auth/auth.service.js';
import { stores } from '../stores/stores.service.js';
import { slugify, newId } from '@mountain/utils';
import { isMongoConnected } from '../../core/db.js';
import { TenantModel, StoreModel } from '../../core/models/index.js';

export const tenantsModule = Router();

interface TenantRecord {
  id: string;
  name: string;
  ownerId: string;
  plan: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  createdAt: string;
}

export const tenants = new Map<string, TenantRecord>();

const createTenantSchema = z.object({
  name: z.string().min(2).max(120),
  storeName: z.string().min(2).max(120),
  industry: z.string().max(80).optional(),
  currency: z.string().length(3).default('USD'),
});

tenantsModule.use(authenticate(loadConfig().jwt.accessSecret));

tenantsModule.post(
  '/',
  wrap(async (req, res) => {
    const body = createTenantSchema.safeParse(req.body);
    if (!body.success) {
      throw new ApiError(400, 'Invalid tenant payload');
    }
    const { name, storeName, industry, currency } = body.data;

    const tenant: TenantRecord = {
      id: newId(),
      name,
      ownerId: req.auth!.userId,
      plan: 'FREE',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };
    tenants.set(tenant.id, tenant);

    // Auto-provision the first store and OWNER membership (spec section 5).
    const store = {
      id: newId(),
      tenantId: tenant.id,
      name: storeName,
      slug: slugify(storeName),
      industry,
      defaultCurrency: currency.toUpperCase(),
      defaultLocale: 'en',
      published: false,
      createdAt: new Date().toISOString(),
    };
    stores.set(store.id, store);

    if (isMongoConnected()) {
      try {
        await TenantModel.create({
          _id: tenant.id,
          name: tenant.name,
          ownerId: tenant.ownerId,
          plan: tenant.plan,
          status: tenant.status,
        });
        await StoreModel.create({
          _id: store.id,
          tenantId: store.tenantId,
          name: store.name,
          slug: store.slug,
          industry: store.industry,
          defaultCurrency: store.defaultCurrency,
          defaultLocale: store.defaultLocale,
          published: store.published,
        });
      } catch (err) {
        console.warn('[tenants] MongoDB creation fallback:', (err as Error).message);
      }
    }

    const membership = {
      userId: req.auth!.userId,
      tenantId: tenant.id,
      role: 'OWNER',
      explicitPermissions: [],
    };
    assignTenantMembership(membership);

    const user = users.get(req.auth!.userId);
    const tokens = user ? await createTokenPair(user, membership, loadConfig().jwt) : undefined;

    res.status(201).json({
      tenant,
      store,
      accessToken: tokens?.accessToken,
      refreshToken: tokens?.refreshToken,
      permissions: permissionsForRole('OWNER'),
    });
  }),
);

tenantsModule.get(
  '/:id',
  wrap(async (req, res) => {
    const tenant = tenants.get(req.params.id!);
    if (!tenant) {
      throw new ApiError(404, 'Tenant not found');
    }
    const isOwnerOrAdmin =
      req.auth!.platformRole !== undefined || tenant.ownerId === req.auth!.userId;
    if (!isOwnerOrAdmin) {
      throw new ApiError(403, 'Not allowed to view this tenant');
    }
    res.json(tenant);
  }),
);
