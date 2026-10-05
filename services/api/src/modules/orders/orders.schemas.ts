import { z } from 'zod';

export const createOrderSchema = z.object({
  customerId: z.string().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        variantId: z.string().optional(),
        quantity: z.number().int().positive().max(999),
      }),
    )
    .min(1),
  taxRate: z.number().min(0).max(1).optional(),
  shippingAmount: z.number().min(0).optional(),
});

export const transitionOrderSchema = z.object({
  status: z.enum([
    'CONFIRMED',
    'PROCESSING',
    'SHIPPED',
    'DELIVERED',
    'CANCELLED',
    'REFUNDED',
    'RETURNED',
    'FAILED',
  ]),
  note: z.string().max(500).optional(),
});

export const listOrdersQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: z
    .enum(['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED', 'RETURNED', 'FAILED'])
    .optional(),
});
