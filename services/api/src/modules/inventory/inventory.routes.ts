import { Router } from 'express';
import { z } from 'zod';
import { loadConfig } from '@mountain/config';
import { clampPageInfo } from '@mountain/utils';
import { authenticate } from '../../core/middleware/authenticate.js';
import { resolveTenant } from '../../core/middleware/resolveTenant.js';
import { requirePermission } from '../../core/middleware/requirePermission.js';
import { wrap } from '../../core/context.js';
import { ApiError } from '../../core/errors.js';
import {
  listInventory,
  getInventory,
  setStock,
  adjustStock,
  viewOf,
  availableOf,
  releaseExpiredReservations,
} from './inventory.service.js';

export const inventoryModule = Router();

inventoryModule.use(authenticate(loadConfig().jwt.accessSecret), resolveTenant);

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().min(1).max(120).optional(),
  lowStockOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

const setStockSchema = z.object({
  stock: z.number().int().min(0),
  lowStockThreshold: z.number().int().min(0).optional(),
});

const adjustSchema = z.object({
  delta: z.number().int().refine((value) => value !== 0, 'Delta must be non-zero'),
});

/**
 * Stock levels, with `available = stock - reserved` exposed directly so the
 * merchant dashboard never has to recompute it.
 */
inventoryModule.get(
  '/',
  requirePermission('inventory.read'),
  wrap(async (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid query');
    }
    const { page, pageSize } = clampPageInfo(parsed.data.page, parsed.data.pageSize);
    const result = await listInventory(req.tenant!.tenantId, {
      search: parsed.data.search,
      lowStockOnly: parsed.data.lowStockOnly,
      page,
      pageSize,
    });
    res.json(result);
  }),
);

/** Low-stock report — the reorder worklist. */
inventoryModule.get(
  '/low-stock',
  requirePermission('inventory.read'),
  wrap(async (req, res) => {
    const { page, pageSize } = clampPageInfo(Number(req.query.page), Number(req.query.pageSize));
    const result = await listInventory(req.tenant!.tenantId, { lowStockOnly: true, page, pageSize });
    res.json(result);
  }),
);

/** Expired holds are released opportunistically, so stock never strands. */
inventoryModule.get(
  '/:productId/:variantId',
  requirePermission('inventory.read'),
  wrap(async (req, res) => {
    await releaseExpiredReservations();
    const record = await getInventory(req.tenant!.tenantId, req.params.productId!, req.params.variantId!);
    if (!record) {
      throw new ApiError(404, 'No inventory record for this product variant');
    }
    res.json(viewOf(record));
  }),
);

/** Absolute stock correction (stocktake). */
inventoryModule.put(
  '/:productId/:variantId',
  requirePermission('inventory.update'),
  wrap(async (req, res) => {
    const parsed = setStockSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid stock payload');
    }
    const record = await setStock(
      req.tenant!.tenantId,
      req.params.productId!,
      req.params.variantId!,
      parsed.data.stock,
      parsed.data.lowStockThreshold,
    );
    res.json(viewOf(record));
  }),
);

/** Relative movement: restock, shrinkage, correction. */
inventoryModule.post(
  '/:productId/:variantId/adjust',
  requirePermission('inventory.update'),
  wrap(async (req, res) => {
    const parsed = adjustSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid adjustment payload');
    }
    const record = await adjustStock(
      req.tenant!.tenantId,
      req.params.productId!,
      req.params.variantId!,
      parsed.data.delta,
    );
    res.json({ ...viewOf(record), available: availableOf(record) });
  }),
);
