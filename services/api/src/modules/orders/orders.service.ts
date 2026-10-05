/**
 * Orders service — order creation, totals and status transitions (spec section 10).
 *
 * Orders are persisted to MongoDB when available, so a restart no longer wipes
 * the merchant's order book. Totals are computed by the server only: a public
 * checkout must never let the client dictate tax or shipping.
 */

import { newId, orderNumber, money, addMoney, multiplyMoney, formatMoney } from '@mountain/utils';
import type { Money, OrderStatus } from '@mountain/types';
import { ApiError } from '../../core/errors.js';
import { isMongoConnected } from '../../core/db.js';
import { OrderModel } from '../../core/models/index.js';
import type { IOrder } from '../../core/models/order.model.js';
import { products } from '../products/products.service.js';
import { releaseReservation } from '../inventory/inventory.service.js';

export interface OrderItemRecord {
  productId: string;
  variantId?: string;
  title: string;
  sku: string;
  quantity: number;
  unitPrice: Money;
}

export interface ShippingAddress {
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: string;
  phone?: string;
}

export type PaymentStatus = 'PENDING' | 'PAID' | 'REFUNDED' | 'FAILED';

export interface OrderRecord {
  id: string;
  tenantId: string;
  storeId?: string;
  number: string;
  customerId?: string;
  customerEmail?: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  items: OrderItemRecord[];
  totals: {
    subtotal: Money;
    discount?: Money;
    tax: Money;
    shipping: Money;
    total: Money;
  };
  shippingAddress?: ShippingAddress;
  paymentId?: string;
  timeline: { status: OrderStatus; at: string; note?: string }[];
  createdAt: string;
  updatedAt: string;
}

export const orders = new Map<string, OrderRecord>();

/** Allowed transitions (spec section 10 diagram). */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED', 'FAILED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED', 'REFUNDED'],
  PROCESSING: ['SHIPPED', 'CANCELLED', 'REFUNDED'],
  SHIPPED: ['DELIVERED', 'RETURNED'],
  DELIVERED: ['RETURNED'],
  CANCELLED: [],
  REFUNDED: [],
  RETURNED: ['REFUNDED'],
  FAILED: [],
};

export const DEFAULT_TAX_RATE = 0;
export const DEFAULT_SHIPPING = 0;

export interface CreateOrderInput {
  tenantId: string;
  /** Supply an id when stock is reserved first, so the hold can reference it. */
  id?: string;
  storeId?: string;
  customerId?: string;
  customerEmail?: string;
  shippingAddress?: ShippingAddress;
  items: { productId: string; variantId?: string; quantity: number }[];
  taxRate?: number;
  shippingAmount?: number;
}

export function computeTotals(
  items: OrderItemRecord[],
  taxRate: number,
  shippingAmount: number,
): OrderRecord['totals'] {
  const currency = items[0]!.unitPrice.currency;
  if (items.some((item) => item.unitPrice.currency !== currency)) {
    throw new ApiError(400, 'Mixed-currency carts are not supported yet');
  }

  let subtotal = money(0, currency);
  for (const item of items) {
    subtotal = addMoney(subtotal, multiplyMoney(item.unitPrice, item.quantity));
  }
  const tax = multiplyMoney(subtotal, taxRate);
  const shipping = money(shippingAmount, currency);
  const total = addMoney(addMoney(subtotal, tax), shipping);

  return { subtotal, tax, shipping, total };
}

export function createOrder(input: CreateOrderInput): OrderRecord {
  if (input.items.length === 0) {
    throw new ApiError(400, 'Order requires at least one item');
  }

  const lineItems: OrderItemRecord[] = input.items.map((item) => {
    const product = products.get(item.productId);
    if (!product || product.tenantId !== input.tenantId) {
      throw new ApiError(404, `Product not found: ${item.productId}`);
    }
    if (product.status !== 'ACTIVE') {
      throw new ApiError(400, `Product not purchasable: ${product.title}`);
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new ApiError(400, `Invalid quantity for ${product.title}`);
    }
    return {
      productId: product.id,
      variantId: item.variantId,
      title: product.title,
      sku: product.sku,
      quantity: item.quantity,
      unitPrice: product.price,
    };
  });

  // Server-side only: tax and shipping are never taken from the client.
  const totals = computeTotals(lineItems, input.taxRate ?? DEFAULT_TAX_RATE, input.shippingAmount ?? DEFAULT_SHIPPING);

  const now = new Date().toISOString();
  const order: OrderRecord = {
    id: input.id ?? newId(),
    tenantId: input.tenantId,
    storeId: input.storeId,
    number: orderNumber(),
    customerId: input.customerId,
    customerEmail: input.customerEmail,
    status: 'PENDING',
    paymentStatus: 'PENDING',
    items: lineItems,
    totals,
    shippingAddress: input.shippingAddress,
    timeline: [{ status: 'PENDING', at: now }],
    createdAt: now,
    updatedAt: now,
  };

  orders.set(order.id, order);
  void persistOrder(order);
  return order;
}

export async function getOrder(tenantId: string, orderId: string): Promise<OrderRecord | undefined> {
  if (isMongoConnected()) {
    const doc = await OrderModel.findOne({ _id: orderId, tenantId });
    if (doc) {
      const record = toRecord(doc);
      orders.set(record.id, record);
      return record;
    }
  }
  const order = orders.get(orderId);
  return order && order.tenantId === tenantId ? order : undefined;
}

export async function listOrders(
  tenantId: string,
  query: { page: number; pageSize: number; status?: OrderStatus; customerId?: string },
): Promise<{ items: OrderRecord[]; total: number; page: number; pageSize: number }> {
  let all: OrderRecord[];

  if (isMongoConnected()) {
    const filter: Record<string, unknown> = { tenantId };
    if (query.status) filter.status = query.status;
    if (query.customerId) filter.customerId = query.customerId;
    const docs = await OrderModel.find(filter).sort({ createdAt: -1 });
    all = docs.map(toRecord);
  } else {
    all = [...orders.values()].filter((order) => order.tenantId === tenantId);
    if (query.status) all = all.filter((order) => order.status === query.status);
    if (query.customerId) all = all.filter((order) => order.customerId === query.customerId);
    all = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const start = (query.page - 1) * query.pageSize;
  return {
    items: all.slice(start, start + query.pageSize),
    total: all.length,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function transitionOrder(
  tenantId: string,
  orderId: string,
  next: OrderStatus,
  note?: string,
): Promise<OrderRecord> {
  const order = await getOrder(tenantId, orderId);
  if (!order) {
    throw new ApiError(404, 'Order not found');
  }
  const allowed = TRANSITIONS[order.status];
  if (!allowed.includes(next)) {
    throw new ApiError(
      409,
      `Cannot transition order from ${order.status} to ${next}. Allowed: ${allowed.join(', ') || 'none'}`,
    );
  }
  order.status = next;
  order.timeline.push({ status: next, at: new Date().toISOString(), note });
  order.updatedAt = new Date().toISOString();

  // A cancelled or failed order must give its stock back, otherwise every
  // abandoned checkout slowly strangles the catalogue. Releasing is idempotent.
  if (next === 'CANCELLED' || next === 'FAILED') {
    await releaseReservation(order.id).catch((err) =>
      console.warn('[orders] failed to release stock hold:', (err as Error).message),
    );
  }

  void persistOrder(order);
  return order;
}

/** Records a payment outcome on the order without going through the status machine. */
export function setPaymentStatus(orderId: string, paymentStatus: PaymentStatus, paymentId?: string): void {
  const order = orders.get(orderId);
  if (!order) return;
  order.paymentStatus = paymentStatus;
  if (paymentId) order.paymentId = paymentId;
  order.updatedAt = new Date().toISOString();
  void persistOrder(order);
}

export function addTimelineNote(orderId: string, note: string, status?: OrderStatus): void {
  const order = orders.get(orderId);
  if (!order) return;
  order.timeline.push({ status: status ?? order.status, at: new Date().toISOString(), note });
  order.updatedAt = new Date().toISOString();
  void persistOrder(order);
}

export function toRecord(doc: IOrder): OrderRecord {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId,
    storeId: doc.storeId,
    number: doc.number,
    customerId: doc.customerId,
    customerEmail: doc.customerEmail,
    status: doc.status,
    paymentStatus: doc.paymentStatus ?? 'PENDING',
    items: doc.items as OrderItemRecord[],
    totals: doc.totals as OrderRecord['totals'],
    shippingAddress: doc.shippingAddress as ShippingAddress | undefined,
    paymentId: doc.paymentId,
    timeline: doc.timeline,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function persistOrder(order: OrderRecord): Promise<void> {
  if (!isMongoConnected()) return;
  try {
    await OrderModel.updateOne(
      { _id: order.id },
      {
        $setOnInsert: { _id: order.id, tenantId: order.tenantId, number: order.number },
        $set: {
          storeId: order.storeId,
          customerId: order.customerId,
          customerEmail: order.customerEmail,
          status: order.status,
          paymentStatus: order.paymentStatus,
          items: order.items,
          totals: order.totals,
          shippingAddress: order.shippingAddress,
          paymentId: order.paymentId,
          timeline: order.timeline,
        },
      },
      { upsert: true },
    );
  } catch (err) {
    console.warn('[orders] Mongo write error:', (err as Error).message);
  }
}

export function summarizeOrder(order: OrderRecord): string {
  return `${order.number} — ${formatMoney(order.totals.total)} — ${order.status}`;
}

/** Test helper. */
export function resetOrderStore(): void {
  orders.clear();
}
