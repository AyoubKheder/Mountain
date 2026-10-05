/**
 * Payment provider abstraction (spec section 11) — Mountain must not be
 * tightly coupled to a single payment provider.
 */

import type { Money, PaymentStatus } from '@mountain/types';

export interface CreatePaymentInput {
  orderId: string;
  amount: Money;
  metadata?: Record<string, string>;
}

export interface PaymentProvider {
  readonly id: string;
  createPayment(
    input: CreatePaymentInput,
  ): Promise<{ providerRef: string; status: PaymentStatus; clientSecret?: string }>;
  capturePayment(providerRef: string): Promise<{ status: PaymentStatus }>;
  refundPayment(providerRef: string, amount: Money): Promise<{ status: PaymentStatus; refundRef: string }>;
  cancelPayment(providerRef: string): Promise<{ status: PaymentStatus }>;
  getPaymentStatus(providerRef: string): Promise<PaymentStatus>;
}

const registry = new Map<string, PaymentProvider>();

export function registerPaymentProvider(provider: PaymentProvider): void {
  registry.set(provider.id, provider);
}

export function getPaymentProvider(id: string): PaymentProvider {
  const provider = registry.get(id);
  if (!provider) {
    throw new Error(`Payment provider not registered: ${id}`);
  }
  return provider;
}

export function listPaymentProviders(): string[] {
  return [...registry.keys()];
}
