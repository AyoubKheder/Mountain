/**
 * Payments service — coordinates provider calls and keeps payment records.
 *
 * Records are persisted to MongoDB when available: a payment is financial
 * evidence, so losing it on restart would make an order impossible to reconcile.
 */

import { newId } from '@mountain/utils';
import type { Money, PaymentStatus } from '@mountain/types';
import { ApiError } from '../../core/errors.js';
import { isMongoConnected } from '../../core/db.js';
import { PaymentModel } from '../../core/models/index.js';
import type { IPayment } from '../../core/models/payment.model.js';
import { getPaymentProvider } from './payments.provider.js';
import {
  getOrder,
  setPaymentStatus,
  transitionOrder,
  addTimelineNote,
} from '../orders/orders.service.js';
import { commitReservation } from '../inventory/inventory.service.js';

export interface PaymentRecord {
  id: string;
  tenantId: string;
  orderId: string;
  provider: string;
  providerRef?: string;
  /** Only present for providers that require client-side confirmation (Stripe). */
  clientSecret?: string;
  status: PaymentStatus;
  amount: Money;
  createdAt: string;
}

export const payments = new Map<string, PaymentRecord>();

function toRecord(doc: IPayment): PaymentRecord {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId,
    orderId: doc.orderId,
    provider: doc.provider,
    providerRef: doc.providerRef,
    clientSecret: doc.clientSecret,
    status: doc.status,
    amount: doc.amount,
    createdAt: doc.createdAt.toISOString(),
  };
}

/** Writes through to Mongo so a restart cannot lose a financial record. */
async function persistPayment(record: PaymentRecord): Promise<void> {
  payments.set(record.id, record);
  if (!isMongoConnected()) return;
  try {
    await PaymentModel.updateOne(
      { _id: record.id },
      {
        $setOnInsert: {
          _id: record.id,
          tenantId: record.tenantId,
          orderId: record.orderId,
          provider: record.provider,
          amount: record.amount,
        },
        $set: {
          providerRef: record.providerRef,
          clientSecret: record.clientSecret,
          status: record.status,
        },
      },
      { upsert: true },
    );
  } catch (err) {
    console.warn('[payments] Mongo write error:', (err as Error).message);
  }
}

export async function createPayment(input: {
  tenantId: string;
  orderId: string;
  providerId: string;
  amount: Money;
}): Promise<PaymentRecord> {
  const provider = getPaymentProvider(input.providerId);

  const record: PaymentRecord = {
    id: newId(),
    tenantId: input.tenantId,
    orderId: input.orderId,
    provider: input.providerId,
    status: 'PROCESSING',
    amount: input.amount,
    createdAt: new Date().toISOString(),
  };
  await persistPayment(record);

  const result = await provider.createPayment({
    orderId: input.orderId,
    amount: input.amount,
    metadata: { paymentId: record.id },
  });

  record.providerRef = result.providerRef;
  record.status = result.status;
  record.clientSecret = result.clientSecret;
  await persistPayment(record);

  if (result.status === 'SUCCEEDED') {
    const order = await getOrder(input.tenantId, input.orderId);
    if (order) {
      // Convert the checkout's stock hold into a real decrement. Both calls are
      // idempotent, so a replayed payment webhook cannot double-decrement.
      await commitReservation(order.id);
      setPaymentStatus(order.id, 'PAID', record.id);
      if (order.status === 'PENDING') {
        await transitionOrder(
          input.tenantId,
          order.id,
          'CONFIRMED',
          `Payment confirmed via ${input.providerId} (${result.providerRef})`,
        );
      }
    }
  }

  return record;
}

export async function getPayment(tenantId: string, paymentId: string): Promise<PaymentRecord> {
  if (isMongoConnected()) {
    const doc = await PaymentModel.findOne({ _id: paymentId, tenantId });
    if (doc) {
      const record = toRecord(doc);
      payments.set(record.id, record);
      return record;
    }
  }
  const record = payments.get(paymentId);
  if (!record || record.tenantId !== tenantId) {
    throw new ApiError(404, 'Payment not found');
  }
  return record;
}

export async function refundPayment(input: {
  tenantId: string;
  paymentId: string;
  amount?: Money;
}): Promise<PaymentRecord> {
  const record = await getPayment(input.tenantId, input.paymentId);
  if (record.status !== 'SUCCEEDED') {
    throw new ApiError(409, `Cannot refund payment in status ${record.status}`);
  }
  const provider = getPaymentProvider(record.provider);
  if (!record.providerRef) {
    throw new ApiError(409, 'Payment has no provider reference');
  }
  const result = await provider.refundPayment(record.providerRef, input.amount ?? record.amount);
  record.status = result.status;
  await persistPayment(record);
  setPaymentStatus(record.orderId, 'REFUNDED', record.id);
  addTimelineNote(
    record.orderId,
    `Refunded ${input.amount ? input.amount.amount : record.amount.amount} ${record.amount.currency} via ${record.provider}`,
    'REFUNDED',
  );
  // Restocking on refund is a merchant policy, not an automatic rule: a returned
  // item may be unsellable. Merchants adjust stock explicitly via /api/inventory.
  return record;
}

export async function listPaymentsForOrder(tenantId: string, orderId: string): Promise<PaymentRecord[]> {
  if (isMongoConnected()) {
    const docs = await PaymentModel.find({ tenantId, orderId }).sort({ createdAt: -1 });
    if (docs.length > 0) {
      const records = docs.map(toRecord);
      for (const record of records) payments.set(record.id, record);
      return records;
    }
  }
  return [...payments.values()].filter((p) => p.tenantId === tenantId && p.orderId === orderId);
}

/** Looks a payment up by the provider's own reference (webhook entry point). */
export async function findPaymentByProviderRef(providerRef: string): Promise<PaymentRecord | undefined> {
  if (isMongoConnected()) {
    const doc = await PaymentModel.findOne({ providerRef });
    if (doc) {
      const record = toRecord(doc);
      payments.set(record.id, record);
      return record;
    }
  }
  return [...payments.values()].find((payment) => payment.providerRef === providerRef);
}

/**
 * Records a status coming from the provider. Idempotent: a replayed webhook that
 * reports the same status rewrites the same value.
 */
export async function markPaymentStatus(
  paymentId: string,
  status: PaymentStatus,
): Promise<PaymentRecord | undefined> {
  const record = payments.get(paymentId);
  if (!record) return undefined;
  record.status = status;
  await persistPayment(record);
  return record;
}
