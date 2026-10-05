/**
 * Payments service — coordinates provider calls and keeps payment records.
 * Records are in-memory for the scaffold; become a Mongo collection later.
 */

import { newId } from '@mountain/utils';
import type { Money, PaymentStatus } from '@mountain/types';
import { ApiError } from '../../core/errors.js';
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
  status: PaymentStatus;
  amount: Money;
  createdAt: string;
}

export const payments = new Map<string, PaymentRecord>();

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
  payments.set(record.id, record);

  const result = await provider.createPayment({
    orderId: input.orderId,
    amount: input.amount,
    metadata: { paymentId: record.id },
  });

  record.providerRef = result.providerRef;
  record.status = result.status;

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

export function getPayment(tenantId: string, paymentId: string): PaymentRecord {
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
  const record = getPayment(input.tenantId, input.paymentId);
  if (record.status !== 'SUCCEEDED') {
    throw new ApiError(409, `Cannot refund payment in status ${record.status}`);
  }
  const provider = getPaymentProvider(record.provider);
  if (!record.providerRef) {
    throw new ApiError(409, 'Payment has no provider reference');
  }
  const result = await provider.refundPayment(record.providerRef, input.amount ?? record.amount);
  record.status = result.status;
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

export function listPaymentsForOrder(tenantId: string, orderId: string): PaymentRecord[] {
  return [...payments.values()].filter(
    (p) => p.tenantId === tenantId && p.orderId === orderId,
  );
}
