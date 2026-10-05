/**
 * Cart service — the persistent basket between browsing and checkout.
 *
 * Shopify's current model (Cart API) treats the cart as a first-class, mutable
 * object with its own id and buyer identity, independent of any session or tab,
 * which is why a cart survives a refresh and is recoverable for abandoned-cart
 * work. Mountain previously had no cart at all: its checkout took a bare list of
 * items, so nothing could be persisted, recovered or resumed.
 *
 * A cart is scoped to one store and belongs to it for its whole life. Lines are
 * validated against the live catalogue and live stock on every write, so a cart
 * can never hold more units than the merchant actually has.
 *
 * See docs/shopify-benchmark.md §5.3.
 */

import { newId } from '@mountain/utils';
import type { Money } from '@mountain/types';
import { ApiError } from '../../core/errors.js';
import { isMongoConnected } from '../../core/db.js';
import { CartModel } from '../../core/models/index.js';
import type { ICart } from '../../core/models/cart.model.js';
import { getProduct } from '../products/products.service.js';
import { checkAvailability } from '../inventory/inventory.service.js';
import { computeTotals, type OrderItemRecord } from '../orders/orders.service.js';

/** Carts are abandoned eventually; keep them long enough to be recoverable. */
const CART_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Guards against a runaway script filling a cart. */
const MAX_QUANTITY_PER_LINE = 99;
const MAX_LINES = 100;

export interface CartLineInput {
  productId: string;
  variantId?: string;
  quantity: number;
}

export interface CartLine {
  /** Stable key so the client can update or remove a line without an extra id. */
  id: string;
  productId: string;
  variantId: string;
  sku: string;
  title: string;
  slug: string;
  imageUrl?: string;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
}

export interface CartRecord {
  id: string;
  tenantId: string;
  storeId?: string;
  sessionId?: string;
  customerId?: string;
  items: { productId: string; variantId: string; quantity: number }[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface CartView extends Omit<CartRecord, 'items'> {
  lines: CartLine[];
  itemCount: number;
  totals: {
    subtotal: Money;
    tax: Money;
    shipping: Money;
    total: Money;
  };
  /** True when every line can currently be served from stock. */
  available: boolean;
  shortages: { productId: string; variantId: string; sku: string; requested: number; available: number }[];
}

/** In-memory mirror, consistent with the rest of the scaffold. */
export const carts = new Map<string, CartRecord>();

export function lineIdOf(productId: string, variantId: string): string {
  return `${productId}:${variantId}`;
}

function toRecord(doc: ICart): CartRecord {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId,
    storeId: doc.storeId,
    sessionId: doc.sessionId,
    customerId: doc.customerId,
    items: (doc.items ?? []).map((item) => ({
      productId: item.productId,
      variantId: item.variantId ?? '',
      quantity: item.quantity,
    })),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    expiresAt: doc.expiresAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function createCart(input: {
  tenantId: string;
  storeId?: string;
  sessionId?: string;
  customerId?: string;
}): Promise<CartRecord> {
  const now = new Date();
  const cart: CartRecord = {
    id: newId(),
    tenantId: input.tenantId,
    storeId: input.storeId,
    sessionId: input.sessionId,
    customerId: input.customerId,
    items: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CART_TTL_MS).toISOString(),
  };
  await persist(cart);
  return cart;
}

export async function getCart(tenantId: string, cartId: string): Promise<CartRecord | undefined> {
  if (isMongoConnected()) {
    const doc = await CartModel.findOne({ _id: cartId, tenantId });
    if (doc) {
      const record = toRecord(doc);
      carts.set(record.id, record);
      return record;
    }
  }
  const cached = carts.get(cartId);
  return cached && cached.tenantId === tenantId ? cached : undefined;
}

export async function requireCart(tenantId: string, cartId: string): Promise<CartRecord> {
  const cart = await getCart(tenantId, cartId);
  if (!cart) {
    throw new ApiError(404, 'Cart not found');
  }
  return cart;
}

/**
 * Resolves a line to a real, sellable variant. Shared by add and update so both
 * apply the same rules.
 */
async function resolveLine(tenantId: string, input: CartLineInput) {
  const product = await getProduct(tenantId, input.productId);
  if (!product) {
    throw new ApiError(404, `Product not found: ${input.productId}`);
  }
  if (product.status !== 'ACTIVE') {
    throw new ApiError(400, `Product not purchasable: ${product.title}`);
  }

  const variants = product.variants ?? [];
  const variant = input.variantId
    ? variants.find((candidate) => candidate.id === input.variantId)
    : variants[0];

  if (!variant) {
    throw new ApiError(
      400,
      input.variantId
        ? `Unknown variant ${input.variantId} for "${product.title}"`
        : `"${product.title}" has no purchasable variant`,
    );
  }

  return { product, variant };
}

/** Rejects a quantity the merchant cannot actually serve today. */
async function assertServable(
  tenantId: string,
  line: { productId: string; variantId: string; quantity: number },
): Promise<void> {
  const { ok, shortages } = await checkAvailability(tenantId, [line]);
  if (!ok) {
    const [shortage] = shortages;
    throw new ApiError(
      409,
      `Only ${shortage?.available ?? 0} unit(s) of ${shortage?.sku ?? 'this item'} are available`,
    );
  }
}

// ---------------------------------------------------------------------------
// Line operations
// ---------------------------------------------------------------------------

export async function addLine(
  tenantId: string,
  cartId: string,
  input: CartLineInput,
): Promise<CartRecord> {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new ApiError(400, 'Quantity must be a positive integer');
  }

  const cart = await requireCart(tenantId, cartId);
  const { variant } = await resolveLine(tenantId, input);
  const id = lineIdOf(input.productId, variant.id);

  const existing = cart.items.find((item) => lineIdOf(item.productId, item.variantId) === id);
  const quantity = (existing?.quantity ?? 0) + input.quantity;

  if (quantity > MAX_QUANTITY_PER_LINE) {
    throw new ApiError(400, `Maximum ${MAX_QUANTITY_PER_LINE} units per line`);
  }
  if (!existing && cart.items.length >= MAX_LINES) {
    throw new ApiError(400, `A cart cannot hold more than ${MAX_LINES} lines`);
  }

  // Validate the resulting total, not the increment: adding 3 to a cart that
  // already holds 8 must fail when only 10 exist.
  await assertServable(tenantId, { productId: input.productId, variantId: variant.id, quantity });

  if (existing) {
    existing.quantity = quantity;
  } else {
    cart.items.push({ productId: input.productId, variantId: variant.id, quantity });
  }

  await persist(cart);
  return cart;
}

export async function updateLine(
  tenantId: string,
  cartId: string,
  lineId: string,
  quantity: number,
): Promise<CartRecord> {
  const cart = await requireCart(tenantId, cartId);
  const line = cart.items.find((item) => lineIdOf(item.productId, item.variantId) === lineId);
  if (!line) {
    throw new ApiError(404, 'Cart line not found');
  }

  // Quantity 0 removes the line — the behaviour every storefront UI expects.
  if (quantity === 0) {
    cart.items = cart.items.filter((item) => lineIdOf(item.productId, item.variantId) !== lineId);
    await persist(cart);
    return cart;
  }

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_LINE) {
    throw new ApiError(400, `Quantity must be between 1 and ${MAX_QUANTITY_PER_LINE}`);
  }

  await assertServable(tenantId, { productId: line.productId, variantId: line.variantId, quantity });
  line.quantity = quantity;

  await persist(cart);
  return cart;
}

export async function removeLine(
  tenantId: string,
  cartId: string,
  lineId: string,
): Promise<CartRecord> {
  const cart = await requireCart(tenantId, cartId);
  const before = cart.items.length;
  cart.items = cart.items.filter((item) => lineIdOf(item.productId, item.variantId) !== lineId);

  if (cart.items.length === before) {
    throw new ApiError(404, 'Cart line not found');
  }

  await persist(cart);
  return cart;
}

export async function clearCart(tenantId: string, cartId: string): Promise<CartRecord> {
  const cart = await requireCart(tenantId, cartId);
  cart.items = [];
  await persist(cart);
  return cart;
}

// ---------------------------------------------------------------------------
// Buyer identity & merge
// ---------------------------------------------------------------------------

/**
 * Attaches an anonymous cart to a customer.
 *
 * When the shopper already has a cart, the two are merged rather than one being
 * discarded — otherwise logging in would silently lose either the basket they
 * built while browsing or the one they already had.
 */
export async function claimCart(
  tenantId: string,
  cartId: string,
  customerId: string,
): Promise<CartRecord> {
  const cart = await requireCart(tenantId, cartId);

  const existing = await findCartForCustomer(tenantId, customerId);
  if (existing && existing.id !== cart.id) {
    await mergeCarts(tenantId, cart.id, existing.id);
    return requireCart(tenantId, existing.id);
  }

  cart.customerId = customerId;
  await persist(cart);
  return cart;
}

/** Moves every line of `sourceCartId` into `targetCartId`, respecting stock. */
export async function mergeCarts(
  tenantId: string,
  sourceCartId: string,
  targetCartId: string,
): Promise<CartRecord> {
  const source = await requireCart(tenantId, sourceCartId);
  const target = await requireCart(tenantId, targetCartId);
  if (source.id === target.id) return target;

  for (const item of source.items) {
    const id = lineIdOf(item.productId, item.variantId);
    const existing = target.items.find((candidate) => lineIdOf(candidate.productId, candidate.variantId) === id);
    const desired = (existing?.quantity ?? 0) + item.quantity;

    // Clamp to what is actually available, so a merge cannot smuggle in
    // unserviceable quantities.
    const { ok } = await checkAvailability(tenantId, [
      { productId: item.productId, variantId: item.variantId, quantity: desired },
    ]);
    const quantity = ok ? Math.min(desired, MAX_QUANTITY_PER_LINE) : existing?.quantity ?? 0;

    if (quantity === 0) continue;
    if (existing) existing.quantity = quantity;
    else if (target.items.length < MAX_LINES) {
      target.items.push({ productId: item.productId, variantId: item.variantId, quantity });
    }
  }

  await persist(target);
  await deleteCart(tenantId, source.id);
  return target;
}

export async function findCartForCustomer(
  tenantId: string,
  customerId: string,
): Promise<CartRecord | undefined> {
  if (isMongoConnected()) {
    const doc = await CartModel.findOne({ tenantId, customerId }).sort({ updatedAt: -1 });
    if (doc) return toRecord(doc);
  }
  return [...carts.values()]
    .filter((cart) => cart.tenantId === tenantId && cart.customerId === customerId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export async function findCartBySession(
  tenantId: string,
  sessionId: string,
): Promise<CartRecord | undefined> {
  if (isMongoConnected()) {
    const doc = await CartModel.findOne({ tenantId, sessionId }).sort({ updatedAt: -1 });
    if (doc) return toRecord(doc);
  }
  return [...carts.values()]
    .filter((cart) => cart.tenantId === tenantId && cart.sessionId === sessionId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export async function deleteCart(tenantId: string, cartId: string): Promise<void> {
  const cart = await getCart(tenantId, cartId);
  if (!cart) return;
  carts.delete(cartId);
  if (isMongoConnected()) {
    await CartModel.deleteOne({ _id: cartId, tenantId }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

/**
 * Enriches a cart with product data so a storefront can render it in one call:
 * titles, prices, per-line totals, order totals and live availability.
 * Tax and shipping are supplied by the caller from the store's own settings.
 */
export async function viewCart(
  cart: CartRecord,
  settings: { taxRate: number; shippingAmount: number },
): Promise<CartView> {
  const lines: CartLine[] = [];
  const orderItems: OrderItemRecord[] = [];

  for (const item of cart.items) {
    const product = await getProduct(cart.tenantId, item.productId);
    const variant = product?.variants?.find((candidate) => candidate.id === item.variantId);
    // A line whose product was deleted or archived is dropped rather than
    // failing the whole cart; the shopper sees an accurate basket.
    if (!product || !variant) continue;

    const unitPrice = variant.price;
    const lineTotal = {
      amount: Number((unitPrice.amount * item.quantity).toFixed(2)),
      currency: unitPrice.currency,
    };

    lines.push({
      id: lineIdOf(item.productId, item.variantId),
      productId: product.id,
      variantId: variant.id,
      sku: variant.sku,
      title: product.title,
      slug: product.slug,
      imageUrl: product.media?.[0]?.url,
      quantity: item.quantity,
      unitPrice,
      lineTotal,
    });

    orderItems.push({
      productId: product.id,
      variantId: variant.id,
      title: product.title,
      sku: variant.sku,
      quantity: item.quantity,
      unitPrice,
    });
  }

  const currency = orderItems[0]?.unitPrice.currency ?? 'USD';
  const totals =
    orderItems.length > 0
      ? computeTotals(orderItems, settings.taxRate, settings.shippingAmount)
      : {
          subtotal: { amount: 0, currency },
          tax: { amount: 0, currency },
          shipping: { amount: 0, currency },
          total: { amount: 0, currency },
        };

  const { ok, shortages } = await checkAvailability(cart.tenantId, cart.items);

  return {
    id: cart.id,
    tenantId: cart.tenantId,
    storeId: cart.storeId,
    sessionId: cart.sessionId,
    customerId: cart.customerId,
    createdAt: cart.createdAt,
    updatedAt: cart.updatedAt,
    expiresAt: cart.expiresAt,
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    totals,
    available: ok,
    shortages,
  };
}

async function persist(cart: CartRecord): Promise<void> {
  cart.updatedAt = new Date().toISOString();
  carts.set(cart.id, cart);

  if (isMongoConnected()) {
    try {
      await CartModel.updateOne(
        { _id: cart.id },
        {
          $setOnInsert: {
            _id: cart.id,
            tenantId: cart.tenantId,
            createdAt: new Date(cart.createdAt),
          },
          $set: {
            storeId: cart.storeId,
            sessionId: cart.sessionId,
            customerId: cart.customerId,
            items: cart.items,
            expiresAt: new Date(cart.expiresAt),
          },
        },
        { upsert: true },
      );
    } catch (err) {
      console.warn('[cart] Mongo write error:', (err as Error).message);
    }
  }
}

/** Test helper. */
export function resetCartStore(): void {
  carts.clear();
}
