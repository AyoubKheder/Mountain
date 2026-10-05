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
import { upsertCustomer, getCustomer, recordOrder, type CustomerRecord } from '../customers/customers.service.js';
import {
  reserveForOrder,
  releaseReservation,
  commitReservation,
  DEFAULT_RESERVATION_TTL_MS,
  type ReservationLine,
} from '../inventory/inventory.service.js';

/** Providers the platform can actually settle today. */
export const IMPLEMENTED_PROVIDERS = ['MOCK', 'CASH_ON_DELIVERY'] as const;
export type ImplementedProvider = (typeof IMPLEMENTED_PROVIDERS)[number];

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
  items: CheckoutItem[];
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
 */
function guardProvider(provider: OrderPaymentProvider | undefined): OrderPaymentProvider {
  const resolved = provider ?? 'MOCK';
  if (resolved === 'NONE') return resolved;

  if (!IMPLEMENTED_PROVIDERS.includes(resolved as ImplementedProvider)) {
    throw new ApiError(
      501,
      `Payment provider "${resolved}" is not implemented yet. ` +
        `Available: ${IMPLEMENTED_PROVIDERS.join(', ')}. ` +
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

  // --- Catalogue resolution --------------------------------------------------
  const { lines, orderItems } = await resolveLines(input.tenantId, input.items);

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

  if (provider === 'MOCK') {
    payment = await createPayment({
      tenantId: input.tenantId,
      orderId: order.id,
      providerId: 'MOCK',
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
  }
  // CASH_ON_DELIVERY keeps the hold and stays PENDING until the courier collects.

  if (customer) {
    await recordOrder(input.tenantId, customer.id, order.totals.total).catch(() => undefined);
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

  return { order, customer, payment, replayed: false };
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
