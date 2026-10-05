/**
 * Public Storefront API — accessible by shoppers and storefront web apps.
 * Does NOT require merchant JWT authentication. Stores are resolved by slug or hostname.
 */

import { Router } from 'express';
import { z } from 'zod';
import { wrap } from '../../core/context.js';
import { ApiError } from '../../core/errors.js';
import { getStoreBySlug, listPublishedStores } from '../stores/stores.service.js';
import {
  listStorefrontProducts,
  isProductVisibleForStore,
  products,
} from '../products/products.service.js';
import { isMongoConnected } from '../../core/db.js';
import { ProductModel } from '../../core/models/index.js';
import { checkAvailability } from '../inventory/inventory.service.js';
import { placeOrder, checkoutSettings } from '../checkout/checkout.service.js';

export const storefrontModule = Router();

/**
 * 0. Marketplace listing — every store that opted into public discovery.
 *
 * Only published stores appear, and only their public profile: never tenant ids,
 * settings or unpublished data. Product counts are computed live so the
 * marketplace never shows a stale catalogue size.
 */
storefrontModule.get(
  '/stores',
  wrap(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : undefined;
    const category = typeof req.query.category === 'string' ? req.query.category.toLowerCase() : undefined;

    let items = await listPublishedStores();

    if (category && category !== 'all') {
      items = items.filter((store) => (store.industry ?? '').toLowerCase() === category);
    }
    if (search) {
      items = items.filter((store) =>
        `${store.name} ${store.industry ?? ''} ${store.description ?? ''}`
          .toLowerCase()
          .includes(search),
      );
    }

    const withCounts = await Promise.all(
      items.map(async (store) => ({
        ...store,
        productCount: (await listStorefrontProducts(store.tenantId, store.id)).length,
      })),
    );

    res.json({ items: withCounts, total: withCounts.length });
  }),
);

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
  /** When supplied, the server reads the basket from the cart, not the body. */
  cartId: z.string().min(1).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        variantId: z.string().optional(),
        quantity: z.number().int().positive().max(99),
      }),
    )
    .optional(),
  paymentProvider: z.enum(['MOCK', 'STRIPE', 'CASH_ON_DELIVERY']).default('MOCK'),
  /** May also be supplied as an `Idempotency-Key` header. */
  idempotencyKey: z.string().min(8).max(200).optional(),
});

/**
 * Live availability for a basket, so the storefront can warn before checkout
 * instead of failing at the last step.
 */
storefrontModule.post(
  '/stores/:slug/availability',
  wrap(async (req, res) => {
    const { slug } = req.params;
    const store = await getStoreBySlug(slug!);
    if (!store) {
      throw new ApiError(404, `Store not found for slug: ${slug}`);
    }

    const parsed = z
      .object({
        items: z
          .array(
            z.object({
              productId: z.string().min(1),
              variantId: z.string().min(1),
              quantity: z.number().int().positive(),
            }),
          )
          .min(1),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid availability payload');
    }

    const result = await checkAvailability(store.tenantId, parsed.data.items);
    res.json(result);
  }),
);

/**
 * 4. Public Storefront Checkout — shoppers place orders.
 *
 * Delegates to the checkout orchestration, which holds stock before creating the
 * order, upserts the customer, and rejects payment providers that cannot settle.
 * Supplying an `Idempotency-Key` makes a double submit or a retry safe: the
 * second attempt replays the first result (HTTP 200) instead of selling twice.
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

    const { customerEmail, customerName, shippingAddress, items, cartId, paymentProvider } =
      parsed.data;

    if (!cartId && (!items || items.length === 0)) {
      throw new ApiError(400, 'Provide either a cartId or a non-empty items list');
    }

    const headerKey = req.headers['idempotency-key'];
    const idempotencyKey =
      parsed.data.idempotencyKey ?? (typeof headerKey === 'string' ? headerKey : undefined);

    const result = await placeOrder({
      tenantId: store.tenantId,
      storeId: store.id,
      cartId,
      items,
      customerEmail,
      customerName,
      shippingAddress,
      paymentProvider,
      idempotencyKey,
      // Tax and shipping come from the store's own settings, never the request.
      ...checkoutSettings(store),
    });

    res.status(result.replayed ? 200 : 201).json({
      orderNumber: result.order.number,
      orderId: result.order.id,
      status: result.order.status,
      paymentStatus: result.order.paymentStatus,
      totals: result.order.totals,
      items: result.order.items,
      customerEmail: result.customer?.email ?? customerEmail,
      customerId: result.customer?.id,
      shippingAddress,
      cartId: result.cartId,
      payment: result.payment
        ? {
            id: result.payment.id,
            provider: result.payment.provider,
            status: result.payment.status,
            amount: result.payment.amount,
            // A real PSP (Stripe) needs the shopper to confirm client-side; this
            // is the token the storefront uses to do that. Null for providers
            // that settle server-side.
            clientSecret: result.payment.clientSecret ?? null,
          }
        : null,
      /** True when the request replayed an earlier attempt instead of selling again. */
      replayed: result.replayed,
    });
  }),
);
