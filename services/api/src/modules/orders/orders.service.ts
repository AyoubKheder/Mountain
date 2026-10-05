/**
 * Orders service — order creation from cart items, totals calculation and
 * status transitions per spec section 10.
 */

import { newId, orderNumber, money, addMoney, multiplyMoney, formatMoney } from '@mountain/utils';
import type { OrderStatus } from '@mountain/types';
import { ApiError } from '../../core/errors.js';
import { products } from '../products/products.service.js';

export interface OrderItemRecord {
  productId: string;
  variantId?: string;
  title: string;
  sku: string;
  quantity: number;
  unitPrice: { amount: number; currency: string };
}

export interface OrderRecord {
  id: string;
  tenantId: string;
  storeId?: string;
  number: string;
  customerId?: string;
  status: OrderStatus;
  items: OrderItemRecord[];
  totals: {
    subtotal: { amount: number; currency: string };
    discount?: { amount: number; currency: string };
    tax: { amount: number; currency: string };
    shipping: { amount: number; currency: string };
    total: { amount: number; currency: string };
  };
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

export const DEFAULT_TAX_RATE = 0.0;
export const DEFAULT_SHIPPING = 0;

export interface CreateOrderInput {
  tenantId: string;
  customerId?: string;
  items: { productId: string; quantity: number; variantId?: string }[];
  taxRate?: number;
  shippingAmount?: number;
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

  const currency = lineItems[0]!.unitPrice.currency;
  if (lineItems.some((li) => li.unitPrice.currency !== currency)) {
    throw new ApiError(400, 'Mixed-currency carts are not supported yet');
  }

  let subtotal = money(0, currency);
  for (const li of lineItems) {
    subtotal = addMoney(subtotal, multiplyMoney(li.unitPrice, li.quantity));
  }
  const tax = multiplyMoney(subtotal, input.taxRate ?? DEFAULT_TAX_RATE);
  const shipping = money(input.shippingAmount ?? DEFAULT_SHIPPING, currency);
  const total = addMoney(addMoney(subtotal, tax), shipping);

  const now = new Date().toISOString();
  const order: OrderRecord = {
    id: newId(),
    tenantId: input.tenantId,
    number: orderNumber(),
    customerId: input.customerId,
    status: 'PENDING',
    items: lineItems,
    totals: { subtotal, tax, shipping, total },
    timeline: [{ status: 'PENDING', at: now }],
    createdAt: now,
    updatedAt: now,
  };
  orders.set(order.id, order);
  return order;
}

export function getOrder(tenantId: string, orderId: string): OrderRecord | undefined {
  const order = orders.get(orderId);
  return order && order.tenantId === tenantId ? order : undefined;
}

export function listOrders(
  tenantId: string,
  query: { page: number; pageSize: number; status?: OrderStatus },
): { items: OrderRecord[]; total: number; page: number; pageSize: number } {
  const all = [...orders.values()]
    .filter((o) => o.tenantId === tenantId)
    .filter((o) => !query.status || o.status === query.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const start = (query.page - 1) * query.pageSize;
  return {
    items: all.slice(start, start + query.pageSize),
    total: all.length,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export function transitionOrder(
  tenantId: string,
  orderId: string,
  next: OrderStatus,
  note?: string,
): OrderRecord {
  const order = getOrder(tenantId, orderId);
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
  return order;
}

export function summarizeOrder(order: OrderRecord): string {
  return `${order.number} — ${formatMoney(order.totals.total)} — ${order.status}`;
}
