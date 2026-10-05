/**
 * Checkout orchestration — the one place where an order is actually placed.
 *
 * Order of operations matters and is deliberate:
 *
 *   1. reject payment providers that are not implemented (before touching stock)
 *   2. replay a previous attempt if the idempotency key was already seen
 *   3. resolve every line against the catalogue (exists, ACTIVE, right tenant)
 *   4. upsert the customer, so the order is attributable to a person
 *   5. take an all-or-nothing stock hold
 *   6. create the order — releasing the hold if this fails
 *   7. capture payment: commit the hold, or leave it held for cash on delivery
 *
 * Step 5 before step 6 means a sold-out order is never persisted. Steps 5 and 6
 * are compensated against each other, so a crash between them cannot strand
 * stock. Idempotency (step 2) is what makes a double-clicked checkout or a
 * replayed webhook harmless.
 *
 * See docs/shopify-benchmark.md §5.1, §5.2 and §5.4.
 */

import { newId } from '@mountain/utils';
import { ApiError } from '../../core/errors.js';
import type { StoreRecord } from '../stores/stores.service.js';
import { getProduct } from '../products/products.service.js';
import {
  createOrder,
  getOrder,
  setPaymentStatus,
  transitionOrder,
  type OrderRecord,
  type ShippingAddress,
} from '../orders/orders.service.js';
import { createPayment, getPayment, type PaymentRecord } from '../payments/payments.service.js';
import { requireCart, deleteCart } from '../cart/cart.service.js';
import { upsertCustomer, getCustomer, recordOrder, type CustomerRecord } from '../customers/customers.service.js';
import { isProviderAvailable, availableProviders } from '../payments/providers/index.js';
import {
  reserveForOrder,
  releaseReservation,
  commitReservation,
  DEFAULT_RESERVATION_TTL_MS,
  type ReservationLine,
} from '../inventory/inventory.service.js';

/**
 * Providers that settle instantly in-process. Stripe joins this set at runtime
 * when `STRIPE_SECRET_KEY` is configured — see providers/index.ts.
 */
export const BUILT_IN_PROVIDERS = ['MOCK', 'CASH_ON_DELIVERY'] as const;
export type ImplementedProvider = (typeof BUILT_IN_PROVIDERS)[number];

export const ALL_PROVIDERS = ['MOCK', 'CASH_ON_DELIVERY', 'STRIPE'] as const;
export type CheckoutProvider = (typeof ALL_PROVIDERS)[number];

/** `NONE` records an order without taking payment (phone, manual, invoice). */
export type OrderPaymentProvider = CheckoutProvider | 'NONE';

/** Cash on delivery settles days later, so its stock hold lives much longer. */
const COD_RESERVATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CheckoutItem {
  productId: string;
  variantId?: string;
  quantity: number;
}

export interface PlaceOrderInput {
  tenantId: string;
  storeId?: string;
  taxRate?: number;
  shippingAmount?: number;
  /** Basket to buy. When supplied, `items` is taken from it server-side. */
  cartId?: string;
  items?: CheckoutItem[];
  customerId?: string;
  customerEmail?: string;
  customerName?: string;
  shippingAddress?: ShippingAddress;
  paymentProvider?: OrderPaymentProvider;
  idempotencyKey?: string;
}

export interface PlaceOrderResult {
  order: OrderRecord;
  customer?: CustomerRecord;
  payment?: PaymentRecord;
  /** True when this call replayed an earlier attempt instead of creating one. */
  replayed: boolean;
  /** The cart that was consumed, if the order came from one. */
  cartId?: string;
}

interface IdempotencyRecord {
  tenantId: string;
  storeId?: string;
  orderId: string;
  customerId?: string;
  paymentId?: string;
  createdAt: string;
}

const idempotency = new Map<string, IdempotencyRecord>();

function idempotencyKey(tenantId: string, storeId: string | undefined, key: string): string {
  return `${tenantId}:${storeId ?? '*'}:${key}`;
}

/**
 * Fails fast on providers we cannot settle. Recording an order as PENDING
 * against a provider that was never called is worse than refusing: the merchant
 * believes the sale is paid when no money moved.
 *
 * The registry is the single source of truth, so configuring Stripe is enough to
 * make it selectable — and removing its key makes it refuse again.
 */
function guardProvider(provider: OrderPaymentProvider | undefined): OrderPaymentProvider {
  const resolved = provider ?? 'MOCK';
  if (resolved === 'NONE') return resolved;

  if (resolved === 'CASH_ON_DELIVERY') return resolved;

  if (!isProviderAvailable(resolved)) {
    throw new ApiError(
      501,
      `Payment provider "${resolved}" is not available. ` +
        `Configured: ${availableProviders().join(', ') || 'none'}. ` +
        'The order was not created and no stock was held.',
    );
  }
  return resolved;
}

/** Binds each cart line to a real, sellable product variant. */
async function resolveLines(
  tenantId: string,
  items: CheckoutItem[],
): Promise<{ lines: ReservationLine[]; orderItems: { productId: string; variantId: string; quantity: number }[] }> {
  const lines: ReservationLine[] = [];
  const orderItems: { productId: string; variantId: string; quantity: number }[] = [];

  for (const item of items) {
    const product = await getProduct(tenantId, item.productId);
    if (!product) {
      throw new ApiError(404, `Product not found: ${item.productId}`);
    }
    if (product.status !== 'ACTIVE') {
      throw new ApiError(400, `Product not purchasable: ${product.title}`);
    }

    const variants = product.variants ?? [];
    const variant = item.variantId
      ? variants.find((candidate) => candidate.id === item.variantId)
      : variants[0];

    if (!variant) {
      throw new ApiError(
        400,
        item.variantId
          ? `Unknown variant ${item.variantId} for "${product.title}"`
          : `"${product.title}" has no purchasable variant`,
      );
    }

    lines.push({ productId: product.id, variantId: variant.id, quantity: item.quantity });
    orderItems.push({ productId: product.id, variantId: variant.id, quantity: item.quantity });
  }

  return { lines, orderItems };
}

export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const provider = guardProvider(input.paymentProvider);

  // --- Idempotent replay -----------------------------------------------------
  const idemKey = input.idempotencyKey
    ? idempotencyKey(input.tenantId, input.storeId, input.idempotencyKey)
    : undefined;

  if (idemKey) {
    const previous = idempotency.get(idemKey);
    if (previous) {
      const order = await getOrder(input.tenantId, previous.orderId);
      if (order) {
        const [customer, payment] = await Promise.all([
          previous.customerId ? getCustomer(input.tenantId, previous.customerId) : undefined,
          Promise.resolve(previous.paymentId ? getPayment(input.tenantId, previous.paymentId) : undefined),
        ]);
        return { order, customer, payment, replayed: true };
      }
    }
  }

  // --- Basket resolution -----------------------------------------------------
  // When a cart is supplied it is authoritative: the server reads the lines from
  // it rather than trusting a client-supplied item list, which is also what makes
  // the idempotency key safe to reuse.
  let checkoutItems = input.items ?? [];

  if (input.cartId) {
    const cart = await requireCart(input.tenantId, input.cartId);
    if (cart.items.length === 0) {
      throw new ApiError(409, 'This cart is empty');
    }
    // A cart belongs to the store it was created in, so an order cannot be
    // assembled from another store's basket.
    if (input.storeId && cart.storeId && cart.storeId !== input.storeId) {
      throw new ApiError(409, 'Cart does not belong to this store');
    }
    checkoutItems = cart.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
    }));
    if (!input.customerId && cart.customerId) input.customerId = cart.customerId;
  }

  if (checkoutItems.length === 0) {
    throw new ApiError(400, 'Order requires at least one item');
  }

  const { lines, orderItems } = await resolveLines(input.tenantId, checkoutItems);

  // --- Stock hold ------------------------------------------------------------
  // Taken before anything is recorded: if the basket cannot be served, the
  // attempt leaves no order *and* no customer behind.
  const orderId = newId();
  await reserveForOrder({
    tenantId: input.tenantId,
    orderId,
    lines,
    ttlMs: provider === 'CASH_ON_DELIVERY' ? COD_RESERVATION_TTL_MS : DEFAULT_RESERVATION_TTL_MS,
  });

  // --- Customer --------------------------------------------------------------
  let customer: CustomerRecord | undefined;
  try {
    if (input.customerId) {
      customer = await getCustomer(input.tenantId, input.customerId);
      if (!customer) throw new ApiError(404, `Customer not found: ${input.customerId}`);
    } else if (input.customerEmail) {
      customer = await upsertCustomer(input.tenantId, {
        email: input.customerEmail,
        firstName: input.customerName,
        phone: input.shippingAddress?.phone,
        address: input.shippingAddress,
      });
    }
  } catch (err) {
    await releaseReservation(orderId).catch(() => undefined);
    throw err;
  }

  // --- Order -----------------------------------------------------------------
  let order: OrderRecord;
  try {
    order = createOrder({
      id: orderId,
      tenantId: input.tenantId,
      storeId: input.storeId,
      customerId: customer?.id,
      customerEmail: customer?.email,
      shippingAddress: input.shippingAddress,
      items: orderItems,
      taxRate: input.taxRate,
      shippingAmount: input.shippingAmount,
    });
  } catch (err) {
    // Nothing was sold — give the units straight back.
    await releaseReservation(orderId).catch(() => undefined);
    throw err;
  }

  // --- Payment ---------------------------------------------------------------
  let payment: PaymentRecord | undefined;

  // 'NONE' records the order without capturing anything (phone orders, manual
  // invoices); COD holds stock until the courier collects.
  if (provider !== 'CASH_ON_DELIVERY' && provider !== 'NONE') {
    payment = await createPayment({
      tenantId: input.tenantId,
      orderId: order.id,
      providerId: provider,
      amount: order.totals.total,
    });

    if (payment.status === 'SUCCEEDED') {
      // Money is in: turn the hold into a real stock decrement.
      await commitReservation(order.id);
      setPaymentStatus(order.id, 'PAID', payment.id);
      if (order.status === 'PENDING') {
        await transitionOrder(input.tenantId, order.id, 'CONFIRMED', `Paid via ${provider}`);
      }
    }
    // Stripe returns REQUIRES_ACTION: the order stays PENDING and the hold stays
    // held until the signed webhook confirms settlement. Money never moves on the
    // strength of a browser redirect.
  }
  // CASH_ON_DELIVERY keeps the hold and stays PENDING until the courier collects.

  if (customer) {
    await recordOrder(input.tenantId, customer.id, order.totals.total).catch(() => undefined);
  }

  // The basket has become an order, so it is consumed. Done only after the order
  // exists — a rejected checkout must leave the shopper's cart intact.
  if (input.cartId) {
    await deleteCart(input.tenantId, input.cartId).catch((err) =>
      console.warn('[checkout] could not delete cart:', (err as Error).message),
    );
  }

  if (idemKey) {
    idempotency.set(idemKey, {
      tenantId: input.tenantId,
      storeId: input.storeId,
      orderId: order.id,
      customerId: customer?.id,
      paymentId: payment?.id,
      createdAt: new Date().toISOString(),
    });
  }

  return { order, customer, payment, replayed: false, cartId: input.cartId };
}

/**
 * Store settings that drive the money. Tax and shipping are read from the store
 * server-side and never accepted from a shopper's request body.
 */
export function checkoutSettings(store: Pick<StoreRecord, 'taxRate' | 'shippingFlatRate'>): {
  taxRate: number;
  shippingAmount: number;
} {
  return {
    taxRate: store.taxRate ?? 0,
    shippingAmount: store.shippingFlatRate ?? 0,
  };
}

/** Test helper. */
export function resetIdempotencyStore(): void {
  idempotency.clear();
}
