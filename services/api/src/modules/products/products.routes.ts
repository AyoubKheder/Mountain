import { Router } from 'express';
import { loadConfig } from '@mountain/config';
import { authenticate } from '../../core/middleware/authenticate.js';
import { resolveTenant } from '../../core/middleware/resolveTenant.js';
import { requirePermission } from '../../core/middleware/requirePermission.js';
import { ApiError } from '../../core/errors.js';
import { wrap } from '../../core/context.js';
import {
  createProduct,
  listProducts,
  getProduct,
  updateProduct,
  archiveProduct,
} from './products.service.js';
import {
  createProductSchema,
  updateProductSchema,
  listProductsQuery,
} from './products.schemas.js';

export const productsModule = Router();

productsModule.use(authenticate(loadConfig().jwt.accessSecret), resolveTenant);

productsModule.post(
  '/',
  requirePermission('products.create'),
  wrap(async (req, res) => {
    const parsed = createProductSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid product payload');
    }
    const product = await createProduct({ ...parsed.data, tenantId: req.tenant!.tenantId });
    res.status(201).json(product);
  }),
);

productsModule.get(
  '/',
  requirePermission('products.read'),
  wrap(async (req, res) => {
    const query = listProductsQuery.parse(req.query);
    const result = await listProducts(req.tenant!.tenantId, query);
    res.json(result);
  }),
);

productsModule.get(
  '/:id',
  requirePermission('products.read'),
  wrap(async (req, res) => {
    const product = await getProduct(req.tenant!.tenantId, req.params.id!);
    if (!product) {
      throw new ApiError(404, 'Product not found');
    }
    res.json(product);
  }),
);

productsModule.patch(
  '/:id',
  requirePermission('products.update'),
  wrap(async (req, res) => {
    const parsed = updateProductSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid product patch');
    }
    const product = await updateProduct(req.tenant!.tenantId, req.params.id!, parsed.data);
    if (!product) {
      throw new ApiError(404, 'Product not found');
    }
    res.json(product);
  }),
);

productsModule.delete(
  '/:id',
  requirePermission('products.delete'),
  wrap(async (req, res) => {
    const archived = await archiveProduct(req.tenant!.tenantId, req.params.id!);
    if (!archived) {
      throw new ApiError(404, 'Product not found');
    }
    res.status(204).end();
  }),
);
