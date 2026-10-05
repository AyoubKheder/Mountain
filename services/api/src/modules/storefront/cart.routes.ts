/**
 * Public cart API — the shopper-facing basket, mirroring Shopify's Cart API.
 *
 * No merchant JWT: the cart id itself is the capability, exactly as Shopify's
 * cart token works. Every route resolves the store by slug first and scopes
 * every read and write to that store's tenant, so a cart id from one store can
 * never be used against another.
 */

import { Router, type Response } from 'express';
import { z } from 'zod';
import { wrap } from '../../core/context.js';
import { ApiError } from '../../core/errors.js';
import { getStoreBySlug } from '../stores/stores.service.js';
import {
  createCart,
  viewCart,
  addLine,
  updateLine,
  removeLine,
  clearCart,
  claimCart,
  requireCart,
  deleteCart,
  type CartView,
} from '../cart/cart.service.js';
import { checkoutSettings } from '../checkout/checkout.service.js';

export const storefrontCartModule = Router();

/** Resolves the store, or 404s — the entry point of every cart route. */
async function requireStore(slug: string | undefined) {
  const store = await getStoreBySlug(slug ?? '');
  if (!store) {
    throw new ApiError(404, `Store not found for slug: ${slug}`);
  }
  return store;
}

async function renderCart(cartId: string, tenantId: string, store: { taxRate?: number; shippingFlatRate?: number }) {
  const cart = await requireCart(tenantId, cartId);
  return viewCart(cart, checkoutSettings(store as { taxRate: number; shippingFlatRate: number }));
}

function respond(res: Response, view: CartView, status = 200): void {
  res.status(status).json(view);
}

const createSchema = z.object({
  sessionId: z.string().min(6).max(120).optional(),
  customerId: z.string().min(1).optional(),
});

const lineSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).optional(),
  quantity: z.number().int().positive().max(99).default(1),
});

const updateSchema = z.object({
  quantity: z.number().int().min(0).max(99),
});

const claimSchema = z.object({
  customerId: z.string().min(1),
});

/** Creates a cart and returns it fully rendered (lines, totals, availability). */
storefrontCartModule.post(
  '/stores/:slug/carts',
  wrap(async (req, res) => {
    const store = await requireStore(req.params.slug);
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid cart payload');
    }

    const cart = await createCart({
      tenantId: store.tenantId,
      storeId: store.id,
      sessionId: parsed.data.sessionId,
      customerId: parsed.data.customerId,
    });

    respond(res, await renderCart(cart.id, store.tenantId, store), 201);
  }),
);

/** The cart as the shopper should see it: lines, totals, live stock status. */
storefrontCartModule.get(
  '/stores/:slug/carts/:cartId',
  wrap(async (req, res) => {
    const store = await requireStore(req.params.slug);
    respond(res, await renderCart(req.params.cartId!, store.tenantId, store));
  }),
);

/**
 * Adds quantity to a line, creating it if needed. Validates the resulting
 * quantity against live stock, so a cart can never hold more than exists.
 */
storefrontCartModule.post(
  '/stores/:slug/carts/:cartId/lines',
  wrap(async (req, res) => {
    const store = await requireStore(req.params.slug);
    const parsed = lineSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid cart line');
    }

    await addLine(store.tenantId, req.params.cartId!, parsed.data);
    respond(res, await renderCart(req.params.cartId!, store.tenantId, store), 201);
  }),
);

/** Sets an absolute quantity. `0` removes the line. */
storefrontCartModule.patch(
  '/stores/:slug/carts/:cartId/lines/:lineId',
  wrap(async (req, res) => {
    const store = await requireStore(req.params.slug);
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid quantity');
    }

    await updateLine(store.tenantId, req.params.cartId!, req.params.lineId!, parsed.data.quantity);
    respond(res, await renderCart(req.params.cartId!, store.tenantId, store));
  }),
);

storefrontCartModule.delete(
  '/stores/:slug/carts/:cartId/lines/:lineId',
  wrap(async (req, res) => {
    const store = await requireStore(req.params.slug);
    await removeLine(store.tenantId, req.params.cartId!, req.params.lineId!);
    respond(res, await renderCart(req.params.cartId!, store.tenantId, store));
  }),
);

/** Empties the cart without deleting it. */
storefrontCartModule.delete(
  '/stores/:slug/carts/:cartId/lines',
  wrap(async (req, res) => {
    const store = await requireStore(req.params.slug);
    await clearCart(store.tenantId, req.params.cartId!);
    respond(res, await renderCart(req.params.cartId!, store.tenantId, store));
  }),
);

/**
 * Claims an anonymous cart for a customer, merging it with any cart that
 * customer already had. Called when a shopper logs in mid-session, so neither
 * basket is lost.
 */
storefrontCartModule.post(
  '/stores/:slug/carts/:cartId/claim',
  wrap(async (req, res) => {
    const store = await requireStore(req.params.slug);
    const parsed = claimSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'customerId is required');
    }

    const merged = await claimCart(store.tenantId, req.params.cartId!, parsed.data.customerId);
    respond(res, await renderCart(merged.id, store.tenantId, store));
  }),
);

/** Deletes the cart outright. */
storefrontCartModule.delete(
  '/stores/:slug/carts/:cartId',
  wrap(async (req, res) => {
    const store = await requireStore(req.params.slug);
    await requireCart(store.tenantId, req.params.cartId!);
    await deleteCart(store.tenantId, req.params.cartId!);
    res.status(204).end();
  }),
);
