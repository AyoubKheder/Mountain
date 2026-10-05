/**
 * Stripe provider — the real payment processor, behind the same interface as the
 * mock. Uses Stripe's REST API over `fetch`, so the platform carries no SDK
 * dependency and the provider stays swappable (spec section 11).
 *
 * Two behaviours differ from the mock, and both are deliberate:
 *
 *  - A PaymentIntent starts in `requires_payment_method`/`requires_action`, not
 *    `SUCCEEDED`. The order therefore stays PENDING and the stock hold stays
 *    held until Stripe confirms — usually via the signed webhook.
 *  - The webhook is the source of truth for settlement, because the customer's
 *    browser is not a trustworthy place to learn that money moved.
 *
 * Amounts are converted to Stripe's minor units (cents) with the currency's real
 * decimal count, so JPY is not charged 100× and USD is not charged 100× wrong.
 *
 * NOTE: this implementation has not been exercised against live Stripe — no key
 * is available in this environment. It fails loudly when unconfigured rather
 * than pretending to work. Verify against Stripe test mode before production.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { decimalsFor } from '@mountain/utils';
import type { Money, PaymentStatus } from '@mountain/types';
import type { CreatePaymentInput, PaymentProvider } from '../payments.provider.js';

const STRIPE_API = 'https://api.stripe.com/v1';

/** Stripe's intent statuses mapped onto Mountain's payment statuses. */
function mapStatus(stripeStatus: string): PaymentStatus {
  switch (stripeStatus) {
    case 'succeeded':
      return 'SUCCEEDED';
    case 'processing':
    case 'requires_capture':
      return 'PROCESSING';
    case 'canceled':
      return 'CANCELLED';
    case 'requires_payment_method':
    case 'requires_confirmation':
    case 'requires_action':
      return 'REQUIRES_ACTION';
    default:
      return 'PROCESSING';
  }
}

function toMinorUnits(amount: Money): number {
  const factor = 10 ** decimalsFor(amount.currency);
  return Math.round(amount.amount * factor);
}

export class StripePaymentProvider implements PaymentProvider {
  readonly id = 'STRIPE';

  constructor(private readonly secretKey: string) {
    if (!secretKey) {
      throw new Error('StripePaymentProvider requires a secret key');
    }
  }

  /** Form-encodes nested keys the way Stripe expects (`metadata[orderId]`). */
  private async request<T>(
    path: string,
    params?: Record<string, string | number | undefined>,
    method: 'GET' | 'POST' = 'POST',
  ): Promise<T> {
    const body = params
      ? new URLSearchParams(
          Object.entries(params)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]): [string, string] => [key, String(value)]),
        )
      : undefined;

    const response = await fetch(`${STRIPE_API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
        // Fixed API version so Stripe cannot change response shapes under us.
        'stripe-version': '2024-06-20',
      },
      body: method === 'POST' ? body : undefined,
    });

    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Stripe returned a non-JSON response (${response.status})`);
    }

    if (!response.ok) {
      const error = (json as { error?: { message?: string } }).error;
      throw new Error(`Stripe ${path} failed (${response.status}): ${error?.message ?? text}`);
    }
    return json as T;
  }

  async createPayment(
    input: CreatePaymentInput,
  ): Promise<{ providerRef: string; status: PaymentStatus; clientSecret?: string }> {
    const intent = await this.request<{ id: string; status: string; client_secret?: string }>(
      '/payment_intents',
      {
        amount: toMinorUnits(input.amount),
        currency: input.amount.currency.toLowerCase(),
        'automatic_payment_methods[enabled]': 'true',
        'metadata[orderId]': input.orderId,
        ...Object.fromEntries(
          Object.entries(input.metadata ?? {}).map(([key, value]) => [`metadata[${key}]`, value]),
        ),
      },
    );

    return {
      providerRef: intent.id,
      status: mapStatus(intent.status),
      clientSecret: intent.client_secret,
    };
  }

  async capturePayment(providerRef: string): Promise<{ status: PaymentStatus }> {
    const intent = await this.request<{ status: string }>(
      `/payment_intents/${providerRef}/capture`,
    );
    return { status: mapStatus(intent.status) };
  }

  async refundPayment(
    providerRef: string,
    amount: Money,
  ): Promise<{ status: PaymentStatus; refundRef: string }> {
    const refund = await this.request<{ id: string; status: string }>('/refunds', {
      payment_intent: providerRef,
      amount: toMinorUnits(amount),
    });
    // Stripe refunds settle asynchronously; treat a created refund as refunded.
    return {
      status: refund.status === 'failed' ? 'FAILED' : 'REFUNDED',
      refundRef: refund.id,
    };
  }

  async cancelPayment(providerRef: string): Promise<{ status: PaymentStatus }> {
    const intent = await this.request<{ status: string }>(
      `/payment_intents/${providerRef}/cancel`,
    );
    return { status: mapStatus(intent.status) };
  }

  async getPaymentStatus(providerRef: string): Promise<PaymentStatus> {
    const intent = await this.request<{ status: string }>(
      `/payment_intents/${providerRef}`,
      undefined,
      'GET',
    );
    return mapStatus(intent.status);
  }
}

/**
 * Verifies a Stripe webhook signature (HMAC-SHA256 of `timestamp.payload`).
 * Returns false rather than throwing, so a forged request is simply rejected.
 */
export function verifyStripeSignature(
  payload: string,
  signatureHeader: string | undefined,
  secret: string,
  toleranceSeconds = 300,
): boolean {
  if (!signatureHeader || !secret) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key?.trim() ?? '', value?.trim() ?? ''];
    }),
  );

  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!Number.isFinite(timestamp) || !signature) return false;

  // Reject stale deliveries to blunt replay attempts.
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
