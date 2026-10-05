/**
 * Public Storefront API — accessible by shoppers and storefront web apps.
 * Does NOT require merchant JWT authentication. Stores are resolved by slug or hostname.
 */

import { Router } from 'express';
import { z } from 'zod';
import { wrap } from '../../core/context.js';
import { ApiError } from '../../core/errors.js';
import { getStoreBySlug } from '../stores/stores.service.js';
import {
  listStorefrontProducts,
  isProductVisibleForStore,
  products,
} from '../products/products.service.js';
import { createOrder, orders } from '../orders/orders.service.js';
import { createPayment } from '../payments/payments.service.js';
import { isMongoConnected } from '../../core/db.js';
import { ProductModel, StoreModel } from '../../core/models/index.js';
import { money, newId } from '@mountain/utils';

export const storefrontModule = Router();

/**
 * 1. Resolve Store by slug
 */
storefrontModule.get(
  '/stores/:slug',
  wrap(async (req, res) => {
    const { slug } = req.params;
    const store = await getStoreBySlug(slug!);
    if (!store) {
      throw new ApiError(404, `Store not found for slug: ${slug}`);
    }
    res.json({
      id: store.id,
      name: store.name,
      slug: store.slug,
      description: store.description,
      industry: store.industry,
      defaultCurrency: store.defaultCurrency,
      defaultLocale: store.defaultLocale,
      published: store.published,
      themeSettings: store.themeSettings ?? {
        themeId: 'sage',
        colors: { background: '#f4f8f3', accent: '#1f5c45', card: '#dce9df', text: '#17211b' },
      },
      customDomains: store.customDomains,
    });
  }),
);

/**
 * 2. List public active products for a store
 */
storefrontModule.get(
  '/stores/:slug/products',
  wrap(async (req, res) => {
    const { slug } = req.params;
    const store = await getStoreBySlug(slug!);
    if (!store) {
      throw new ApiError(404, `Store not found for slug: ${slug}`);
    }

    const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : undefined;
    const category = typeof req.query.category === 'string' ? req.query.category.toLowerCase() : undefined;

    // Tenant-scoped: the owning tenant is mandatory, the store only narrows it.
    let items = await listStorefrontProducts(store.tenantId, store.id);

    if (search) {
      items = items.filter(
        (p) =>
          p.title.toLowerCase().includes(search) ||
          p.description.toLowerCase().includes(search) ||
          (p.brand && p.brand.toLowerCase().includes(search)),
      );
    }

    if (category && category !== 'all') {
      items = items.filter((p) =>
        p.categoryIds.some((c) => c.toLowerCase() === category) ||
        p.tags.some((t) => t.toLowerCase() === category),
      );
    }

    res.json({
      items,
      total: items.length,
      store: {
        id: store.id,
        name: store.name,
        currency: store.defaultCurrency,
      },
    });
  }),
);

/**
 * 3. Get single product by slug
 */
storefrontModule.get(
  '/stores/:slug/products/:productSlug',
  wrap(async (req, res) => {
    const { slug, productSlug } = req.params;
    const store = await getStoreBySlug(slug!);
    if (!store) {
      throw new ApiError(404, `Store not found for slug: ${slug}`);
    }

    let productDoc: Record<string, unknown> | undefined;

    if (isMongoConnected()) {
      const doc = await ProductModel.findOne({
        slug: productSlug!.toLowerCase(),
        status: 'ACTIVE',
        tenantId: store.tenantId,
        $or: [{ storeId: store.id }, { storeId: { $exists: false } }, { storeId: null }],
      });
      if (doc) {
        productDoc = {
          id: doc._id.toString(),
          title: doc.title,
          slug: doc.slug,
          description: doc.description,
          brand: doc.brand,
          price: doc.price,
          sku: doc.sku,
          media: doc.media,
          options: doc.options,
          variants: doc.variants,
          seo: doc.seo,
        };
      }
    }

    if (!productDoc) {
      const match = [...products.values()].find(
        (p) =>
          p.slug.toLowerCase() === productSlug!.toLowerCase() &&
          isProductVisibleForStore(p, store.tenantId, store.id),
      );
      if (match) {
        productDoc = match as unknown as Record<string, unknown>;
      }
    }

    if (!productDoc) {
      throw new ApiError(404, `Product not found: ${productSlug}`);
    }

    res.json(productDoc);
  }),
);

const checkoutSchema = z.object({
  customerEmail: z.string().email(),
  customerName: z.string().min(1).optional(),
  shippingAddress: z.object({
    line1: z.string().min(1),
    line2: z.string().optional(),
    city: z.string().min(1),
    region: z.string().optional(),
    postalCode: z.string().min(1),
    country: z.string().min(1),
    phone: z.string().optional(),
  }),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        variantId: z.string().optional(),
        quantity: z.number().int().positive().max(99),
      }),
    )
    .min(1),
  paymentProvider: z.enum(['MOCK', 'STRIPE', 'CASH_ON_DELIVERY']).default('MOCK'),
});

/**
 * 4. Public Storefront Checkout — shoppers place orders
 */
storefrontModule.post(
  '/stores/:slug/checkout',
  wrap(async (req, res) => {
    const { slug } = req.params;
    const store = await getStoreBySlug(slug!);
    if (!store) {
      throw new ApiError(404, `Store not found for slug: ${slug}`);
    }

    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid checkout payload');
    }

    const { customerEmail, shippingAddress, items, paymentProvider } = parsed.data;

    // Create the order scoped to this store and tenant
    const order = createOrder({
      tenantId: store.tenantId,
      items,
      shippingAmount: 0,
      taxRate: 0,
    });

    order.storeId = store.id;
    order.timeline.push({
      status: 'PENDING',
      at: new Date().toISOString(),
      note: `Checkout started by ${customerEmail} on ${store.name}`,
    });

    // Create immediate payment if MOCK or CASH_ON_DELIVERY
    let paymentRecord;
    if (paymentProvider === 'MOCK' || paymentProvider === 'CASH_ON_DELIVERY') {
      paymentRecord = await createPayment({
        tenantId: store.tenantId,
        orderId: order.id,
        providerId: 'MOCK',
        amount: order.totals.total,
      });
    }

    res.status(201).json({
      orderNumber: order.number,
      orderId: order.id,
      status: order.status,
      totals: order.totals,
      items: order.items,
      customerEmail,
      shippingAddress,
      payment: paymentRecord,
    });
  }),
);
