/**
 * Stripe webhook handling — the authoritative path for settlement.
 *
 * A shopper returning from Stripe's hosted page proves nothing; the signed
 * webhook is what tells us money actually moved. Two properties matter:
 *
 *  - **Authenticity**: the HMAC signature is verified against the raw body, so a
 *    forged POST to this public endpoint is ignored.
 *  - **Idempotence**: Stripe retries deliveries, so every handler is written to
 *    be safe to run twice. Committing a stock reservation twice would corrupt
 *    inventory in the opposite direction — the reservation's own status guards
 *    that, and the order transition is a no-op once already CONFIRMED.
 */

import { ApiError } from '../../core/errors.js';
import { verifyStripeSignature } from './providers/stripe.provider.js';
import { findPaymentByProviderRef, getPayment, markPaymentStatus } from './payments.service.js';
import { commitReservation, releaseReservation } from '../inventory/inventory.service.js';
import { getOrder, transitionOrder, setPaymentStatus, addTimelineNote } from '../orders/orders.service.js';

interface StripeEvent {
  id: string;
  type: string;
  data?: { object?: Record<string, unknown> };
}

/** Events we act on. Anything else is acknowledged and ignored. */
const HANDLED = new Set([
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'charge.refunded',
]);

export async function handleStripeWebhook(
  rawBody: Buffer | undefined,
  signature: string | undefined,
): Promise<{ received: boolean; handled?: string; note?: string }> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new ApiError(503, 'STRIPE_WEBHOOK_SECRET is not configured');
  }

  const payload = rawBody ? rawBody.toString('utf8') : '';
  if (!verifyStripeSignature(payload, signature, secret)) {
    // Deliberately vague: do not help a forger refine their request.
    throw new ApiError(400, 'Invalid Stripe signature');
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    throw new ApiError(400, 'Malformed webhook payload');
  }

  if (!HANDLED.has(event.type)) {
    return { received: true, note: `ignored: ${event.type}` };
  }

  const object = event.data?.object ?? {};
  const intentId = typeof object.id === 'string' ? object.id : undefined;
  if (!intentId) {
    return { received: true, note: 'no payment intent in payload' };
  }

  const payment = await findPaymentByProviderRef(intentId);
  if (!payment) {
    // An intent we never created (another integration, or a different account).
    return { received: true, note: `no local payment for ${intentId}` };
  }

  const tenantId = payment.tenantId;
  const orderId = payment.orderId;
  const order = await getOrder(tenantId, orderId);
  if (!order) {
    return { received: true, note: `order ${orderId} not found` };
  }

  switch (event.type) {
    case 'payment_intent.succeeded': {
      // Idempotent by construction: committing twice is a no-op.
      await commitReservation(orderId);
      await markPaymentStatus(payment.id, 'SUCCEEDED');
      setPaymentStatus(orderId, 'PAID', payment.id);
      if (order.status === 'PENDING') {
        await transitionOrder(tenantId, orderId, 'CONFIRMED', 'Payment settled via STRIPE');
      }
      return { received: true, handled: event.type };
    }

    case 'payment_intent.payment_failed': {
      await markPaymentStatus(payment.id, 'FAILED');
      setPaymentStatus(orderId, 'FAILED', payment.id);
      // Give the stock back: the sale did not happen.
      await releaseReservation(orderId);
      if (order.status === 'PENDING') {
        await transitionOrder(tenantId, orderId, 'FAILED', 'Payment failed at the provider');
      }
      return { received: true, handled: event.type };
    }

    case 'payment_intent.canceled': {
      await markPaymentStatus(payment.id, 'CANCELLED');
      await releaseReservation(orderId);
      if (order.status === 'PENDING') {
        await transitionOrder(tenantId, orderId, 'CANCELLED', 'Payment cancelled at the provider');
      }
      return { received: true, handled: event.type };
    }

    case 'charge.refunded': {
      await markPaymentStatus(payment.id, 'REFUNDED');
      setPaymentStatus(orderId, 'REFUNDED', payment.id);
      addTimelineNote(orderId, 'Refund settled via STRIPE', 'REFUNDED');
      // Stock is not restocked automatically: a returned item may be unsellable.
      return { received: true, handled: event.type };
    }

    default:
      return { received: true, note: `unhandled: ${event.type}` };
  }
}

/**
 * Re-reads a payment from the provider and reconciles the local record. Used by
 * the worker for deliveries that were missed — webhooks can be lost.
 */
export async function reconcilePayment(tenantId: string, paymentId: string): Promise<string> {
  const payment = await getPayment(tenantId, paymentId);
  if (!payment.providerRef) {
    throw new ApiError(409, 'Payment has no provider reference');
  }

  const { getPaymentProvider } = await import('./payments.provider.js');
  const provider = getPaymentProvider(payment.provider);
  const status = await provider.getPaymentStatus(payment.providerRef);

  if (status !== payment.status) {
    await markPaymentStatus(payment.id, status);
  }
  return status;
}
