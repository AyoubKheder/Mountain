import { z } from 'zod';

export const productVariantSchema = z.object({
  id: z.string().optional(),
  sku: z.string().min(1).max(64),
  price: z.number().nonnegative(),
  currency: z.string().length(3).default('USD'),
  compareAtPrice: z.number().nonnegative().optional(),
  options: z.record(z.string()).default({}),
  stock: z.number().int().default(0),
});

export const productMediaSchema = z.object({
  url: z.string().url(),
  type: z.enum(['IMAGE', 'VIDEO']).default('IMAGE'),
  alt: z.string().max(200).optional(),
  position: z.number().int().default(0),
});

export const productOptionSchema = z.object({
  name: z.string().min(1).max(50),
  values: z.array(z.string().min(1)),
});

export const createProductSchema = z.object({
  storeId: z.string().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(10000).default(''),
  brand: z.string().max(120).optional(),
  categoryIds: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  price: z.number().nonnegative(),
  currency: z.string().length(3).default('USD'),
  sku: z.string().max(64).optional(),
  options: z.array(productOptionSchema).optional(),
  variants: z.array(productVariantSchema).optional(),
  media: z.array(productMediaSchema).optional(),
  seo: z
    .object({
      title: z.string().max(200).optional(),
      description: z.string().max(500).optional(),
      keywords: z.array(z.string()).optional(),
    })
    .optional(),
});

export const updateProductSchema = createProductSchema.partial().extend({
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
});

export const listProductsQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  search: z.string().max(120).optional(),
  storeId: z.string().optional(),
  categoryId: z.string().optional(),
});
