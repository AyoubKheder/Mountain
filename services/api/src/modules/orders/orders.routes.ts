import { Router } from 'express';
import { loadConfig } from '@mountain/config';
import { authenticate } from '../../core/middleware/authenticate.js';
import { resolveTenant } from '../../core/middleware/resolveTenant.js';
import { requirePermission } from '../../core/middleware/requirePermission.js';
import { ApiError } from '../../core/errors.js';
import { wrap } from '../../core/context.js';
import {
  createOrder,
  getOrder,
  listOrders,
  transitionOrder,
} from './orders.service.js';
import { createOrderSchema, transitionOrderSchema, listOrdersQuery } from './orders.schemas.js';

export const ordersModule = Router();

ordersModule.use(authenticate(loadConfig().jwt.accessSecret), resolveTenant);

ordersModule.post(
  '/',
  requirePermission('orders.create'),
  wrap(async (req, res) => {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid order payload');
    }
    const order = createOrder({ ...parsed.data, tenantId: req.tenant!.tenantId });
    res.status(201).json(order);
  }),
);

ordersModule.get(
  '/',
  requirePermission('orders.read'),
  wrap(async (req, res) => {
    const query = listOrdersQuery.parse(req.query);
    res.json(listOrders(req.tenant!.tenantId, query));
  }),
);

ordersModule.get(
  '/:id',
  requirePermission('orders.read'),
  wrap(async (req, res) => {
    const order = getOrder(req.tenant!.tenantId, req.params.id!);
    if (!order) {
      throw new ApiError(404, 'Order not found');
    }
    res.json(order);
  }),
);

ordersModule.post(
  '/:id/transition',
  requirePermission('orders.update'),
  wrap(async (req, res) => {
    const parsed = transitionOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid transition');
    }
    const order = transitionOrder(
      req.tenant!.tenantId,
      req.params.id!,
      parsed.data.status,
      parsed.data.note,
    );
    res.json(order);
  }),
);
