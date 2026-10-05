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
  listCustomers,
  getCustomer,
  updateCustomer,
  listCustomerOrders,
} from './customers.service.js';

export const customersModule = Router();

customersModule.use(authenticate(loadConfig().jwt.accessSecret), resolveTenant);

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().min(1).max(120).optional(),
});

const updateSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  phone: z.string().min(3).max(40).optional(),
  note: z.string().max(2000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(50).optional(),
  acceptsMarketing: z.boolean().optional(),
});

customersModule.get(
  '/',
  requirePermission('customers.read'),
  wrap(async (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid query');
    }
    const { page, pageSize } = clampPageInfo(parsed.data.page, parsed.data.pageSize);
    const result = await listCustomers(req.tenant!.tenantId, {
      search: parsed.data.search,
      page,
      pageSize,
    });
    res.json(result);
  }),
);

customersModule.get(
  '/:id',
  requirePermission('customers.read'),
  wrap(async (req, res) => {
    const customer = await getCustomer(req.tenant!.tenantId, req.params.id!);
    if (!customer) {
      throw new ApiError(404, 'Customer not found');
    }
    res.json(customer);
  }),
);

/** Order history — the reason the customer record exists. */
customersModule.get(
  '/:id/orders',
  requirePermission('customers.read'),
  wrap(async (req, res) => {
    const customer = await getCustomer(req.tenant!.tenantId, req.params.id!);
    if (!customer) {
      throw new ApiError(404, 'Customer not found');
    }
    const items = await listCustomerOrders(req.tenant!.tenantId, customer.id);
    res.json({ items, total: items.length, customerId: customer.id });
  }),
);

customersModule.patch(
  '/:id',
  requirePermission('customers.update'),
  wrap(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid customer patch');
    }
    const customer = await updateCustomer(req.tenant!.tenantId, req.params.id!, parsed.data);
    if (!customer) {
      throw new ApiError(404, 'Customer not found');
    }
    res.json(customer);
  }),
);
