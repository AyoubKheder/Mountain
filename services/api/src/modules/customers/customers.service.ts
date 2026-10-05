/**
 * Customers service — the shopper record behind every order.
 *
 * Without this, an order is an anonymous pile of line items: no order history,
 * no abandoned-cart recovery, no segmentation, no repeat-purchase view. The
 * checkout upserts a customer by email, so guest checkout still builds the
 * merchant's customer list. See docs/shopify-benchmark.md §5.4.
 */

import { newId, money } from '@mountain/utils';
import type { Money } from '@mountain/types';
import { ApiError } from '../../core/errors.js';
import { isMongoConnected } from '../../core/db.js';
import { CustomerModel } from '../../core/models/index.js';
import { listOrders } from '../orders/orders.service.js';
import type { ICustomer, ICustomerAddress } from '../../core/models/customer.model.js';

export type CustomerAddress = ICustomerAddress;

export interface CustomerRecord {
  id: string;
  tenantId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  note?: string;
  tags: string[];
  acceptsMarketing: boolean;
  addresses: CustomerAddress[];
  ordersCount: number;
  totalSpent: Money;
  lastOrderAt?: string;
  createdAt: string;
  updatedAt: string;
}

export const customers = new Map<string, CustomerRecord>();
/** tenantId:email → customerId, so the same shopper is one record per tenant. */
const customersByEmail = new Map<string, string>();

function key(tenantId: string, email: string): string {
  return `${tenantId}:${email.toLowerCase()}`;
}

function toRecord(doc: ICustomer): CustomerRecord {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId,
    email: doc.email,
    firstName: doc.firstName,
    lastName: doc.lastName,
    phone: doc.phone,
    note: doc.note,
    tags: doc.tags ?? [],
    acceptsMarketing: doc.acceptsMarketing,
    addresses: (doc.addresses ?? []) as CustomerAddress[],
    ordersCount: doc.ordersCount,
    totalSpent: doc.totalSpent,
    lastOrderAt: doc.lastOrderAt?.toISOString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function normaliseEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes('@')) {
    throw new ApiError(400, `Invalid customer email: ${email}`);
  }
  return normalized;
}

/**
 * Finds an existing customer or creates one. This is what makes guest checkout
 * contribute to the merchant's customer base instead of vanishing.
 */
export async function upsertCustomer(
  tenantId: string,
  input: {
    email: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    acceptsMarketing?: boolean;
    address?: CustomerAddress;
  },
): Promise<CustomerRecord> {
  const email = normaliseEmail(input.email);
  const existing = await findCustomerByEmail(tenantId, email);

  if (existing) {
    const updated: CustomerRecord = {
      ...existing,
      firstName: input.firstName ?? existing.firstName,
      lastName: input.lastName ?? existing.lastName,
      phone: input.phone ?? existing.phone,
      acceptsMarketing: input.acceptsMarketing ?? existing.acceptsMarketing,
      addresses: mergeAddress(existing.addresses, input.address),
      updatedAt: new Date().toISOString(),
    };
    await persist(updated);
    return updated;
  }

  const now = new Date().toISOString();
  const customer: CustomerRecord = {
    id: newId(),
    tenantId,
    email,
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone,
    tags: [],
    acceptsMarketing: input.acceptsMarketing ?? false,
    addresses: input.address ? [{ ...input.address, isDefault: true }] : [],
    ordersCount: 0,
    totalSpent: money(0, 'USD'),
    createdAt: now,
    updatedAt: now,
  };

  await persist(customer);
  return customer;
}

function mergeAddress(
  addresses: CustomerAddress[],
  address?: CustomerAddress,
): CustomerAddress[] {
  if (!address) return addresses;
  const duplicate = addresses.some(
    (a) => a.line1 === address.line1 && a.postalCode === address.postalCode && a.country === address.country,
  );
  if (duplicate) return addresses;
  return [...addresses, { ...address, isDefault: addresses.length === 0 }];
}

export async function findCustomerByEmail(
  tenantId: string,
  email: string,
): Promise<CustomerRecord | undefined> {
  const normalized = email.toLowerCase();

  if (isMongoConnected()) {
    const doc = await CustomerModel.findOne({ tenantId, email: normalized });
    if (doc) {
      const record = toRecord(doc);
      customers.set(record.id, record);
      customersByEmail.set(key(tenantId, normalized), record.id);
      return record;
    }
  }

  const id = customersByEmail.get(key(tenantId, normalized));
  const cached = id ? customers.get(id) : undefined;
  return cached && cached.tenantId === tenantId ? cached : undefined;
}

export async function getCustomer(
  tenantId: string,
  customerId: string,
): Promise<CustomerRecord | undefined> {
  if (isMongoConnected()) {
    const doc = await CustomerModel.findOne({ _id: customerId, tenantId });
    if (doc) {
      const record = toRecord(doc);
      customers.set(record.id, record);
      return record;
    }
  }
  const cached = customers.get(customerId);
  return cached && cached.tenantId === tenantId ? cached : undefined;
}

export async function listCustomers(
  tenantId: string,
  query: { search?: string; page: number; pageSize: number },
): Promise<{ items: CustomerRecord[]; total: number; page: number; pageSize: number }> {
  let all: CustomerRecord[];

  if (isMongoConnected()) {
    const docs = await CustomerModel.find({ tenantId }).sort({ createdAt: -1 });
    if (docs.length > 0) {
      all = docs.map(toRecord);
      for (const record of all) customers.set(record.id, record);
    } else {
      all = [...customers.values()].filter((c) => c.tenantId === tenantId);
    }
  } else {
    all = [...customers.values()].filter((c) => c.tenantId === tenantId);
  }

  let items = all;
  if (query.search) {
    const q = query.search.toLowerCase();
    items = items.filter((c) =>
      `${c.email} ${c.firstName ?? ''} ${c.lastName ?? ''}`.toLowerCase().includes(q),
    );
  }
  items = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const start = (query.page - 1) * query.pageSize;
  return {
    items: items.slice(start, start + query.pageSize),
    total: items.length,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function updateCustomer(
  tenantId: string,
  customerId: string,
  patch: Partial<Pick<CustomerRecord, 'firstName' | 'lastName' | 'phone' | 'note' | 'tags' | 'acceptsMarketing'>>,
): Promise<CustomerRecord | undefined> {
  const existing = await getCustomer(tenantId, customerId);
  if (!existing) return undefined;

  const updated: CustomerRecord = {
    ...existing,
    firstName: patch.firstName ?? existing.firstName,
    lastName: patch.lastName ?? existing.lastName,
    phone: patch.phone ?? existing.phone,
    note: patch.note ?? existing.note,
    tags: patch.tags ?? existing.tags,
    acceptsMarketing: patch.acceptsMarketing ?? existing.acceptsMarketing,
    updatedAt: new Date().toISOString(),
  };
  await persist(updated);
  return updated;
}

/**
 * Called when an order is placed, so lifetime value and order history stay real.
 * Keeps the customer's currency as the one they first purchased in.
 */
export async function recordOrder(
  tenantId: string,
  customerId: string,
  orderTotal: Money,
): Promise<CustomerRecord | undefined> {
  const existing = await getCustomer(tenantId, customerId);
  if (!existing) return undefined;

  const sameCurrency = existing.totalSpent.currency === orderTotal.currency;
  const totalSpent = sameCurrency
    ? money(existing.totalSpent.amount + orderTotal.amount, orderTotal.currency)
    : existing.totalSpent;

  const updated: CustomerRecord = {
    ...existing,
    ordersCount: existing.ordersCount + 1,
    totalSpent,
    lastOrderAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await persist(updated);
  return updated;
}

/**
 * The customer's order history, newest first. Merchants read this in the
 * dashboard. Goes through the orders service so the MongoDB and in-memory paths
 * cannot drift apart — reading Mongo only, with an empty fallback, silently
 * returned nothing on the in-memory path.
 */
export async function listCustomerOrders(tenantId: string, customerId: string) {
  const result = await listOrders(tenantId, { customerId, page: 1, pageSize: 200 });
  return result.items.map((order) => ({
    id: order.id,
    number: order.number,
    status: order.status,
    paymentStatus: order.paymentStatus,
    totals: order.totals,
    createdAt: order.createdAt,
  }));
}

async function persist(record: CustomerRecord): Promise<void> {
  customers.set(record.id, record);
  customersByEmail.set(key(record.tenantId, record.email), record.id);

  if (isMongoConnected()) {
    try {
      await CustomerModel.updateOne(
        { _id: record.id },
        {
          $set: {
            tenantId: record.tenantId,
            email: record.email,
            firstName: record.firstName,
            lastName: record.lastName,
            phone: record.phone,
            note: record.note,
            tags: record.tags,
            acceptsMarketing: record.acceptsMarketing,
            addresses: record.addresses,
            ordersCount: record.ordersCount,
            totalSpent: record.totalSpent,
            ...(record.lastOrderAt ? { lastOrderAt: new Date(record.lastOrderAt) } : {}),
          },
          $setOnInsert: { _id: record.id },
        },
        { upsert: true },
      );
    } catch (err) {
      console.warn('[customers] Mongo write error:', (err as Error).message);
    }
  }
}

/** Test helper. */
export function resetCustomerStore(): void {
  customers.clear();
  customersByEmail.clear();
}
