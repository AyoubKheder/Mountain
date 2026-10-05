/**
 * Reservation sweeper.
 *
 * A stock hold has a TTL, but a TTL only helps if something acts on it. This
 * timer is that something: every interval it releases the holds that have
 * expired and closes the orders they belonged to.
 *
 * Why it matters: the mock/Stripe `REQUIRES_ACTION` path and cash-on-delivery
 * both deliberately leave an order PENDING with stock held, waiting for money.
 * If the shopper never completes the payment, nothing else in the system will
 * ever touch that hold — `reserved` would stay incremented forever and the
 * product would slowly become unsellable while its stock sits untouched.
 *
 * Order of operations per expired hold:
 *   1. release the stock (idempotent, keyed by order id);
 *   2. cancel the abandoned payment intent at the provider, so a link that is
 *      still circulating cannot be charged after the stock is gone;
 *   3. move the order PENDING → CANCELLED with a timeline note.
 *
 * Every step is failure-tolerant: a provider outage must never stop the sweep
 * from returning stock.
 */

import { releaseExpiredReservations } from './inventory.service.js';
import { addTimelineNote, getOrder, transitionOrder } from '../orders/orders.service.js';
import { listPaymentsForOrder, markPaymentStatus } from '../payments/payments.service.js';
import { getPaymentProvider } from '../payments/payments.provider.js';

export interface SweepResult {
  released: number;
  cancelled: number;
}

/** Payment states that are still waiting on the shopper, and so safe to abandon. */
const ABANDONABLE_PAYMENT_STATUSES = ['REQUIRES_ACTION', 'PROCESSING'] as const;

/**
 * Releases expired holds and closes the orders behind them. Exported so it can
 * be called on demand (and asserted on) rather than only on a timer.
 */
export async function sweepExpiredReservations(now: Date = new Date()): Promise<SweepResult> {
  const expired = await releaseExpiredReservations(now);

  let cancelled = 0;

  for (const reservation of expired) {
    // A reservation is keyed by the order it was taken for.
    const orderId = reservation.id;

    try {
      const order = await getOrder(reservation.tenantId, orderId);

      if (!order) {
        // The hold existed without an order (an attempt that died mid-checkout);
        // releasing it was the whole job. Worth saying out loud, because a
        // tenant mismatch here would silently strand an unpaid order.
        console.log(
          `[sweeper] released ${reservation.id} (tenant ${reservation.tenantId}) but found no matching order to close`,
        );
        continue;
      }

      // Abandon the payment attempts so no stale payment link stays chargeable.
      const attempts = await listPaymentsForOrder(reservation.tenantId, orderId).catch(() => []);
      for (const payment of attempts) {
        if (!ABANDONABLE_PAYMENT_STATUSES.includes(
          payment.status as (typeof ABANDONABLE_PAYMENT_STATUSES)[number],
        )) {
          continue;
        }
        // Nothing to cancel provider-side when the attempt never returned a ref.
        if (payment.providerRef) {
          try {
            await getPaymentProvider(payment.provider).cancelPayment(payment.providerRef);
          } catch (err) {
            console.warn(
              `[sweeper] could not cancel ${payment.provider} payment ${payment.providerRef}:`,
              (err as Error).message,
            );
          }
        }
        await markPaymentStatus(payment.id, 'CANCELLED').catch(() => undefined);
      }

      if (order.status === 'PENDING') {
        await transitionOrder(
          reservation.tenantId,
          orderId,
          'CANCELLED',
          'Stock hold expired before payment — units returned to stock',
        );
        cancelled += 1;
      } else {
        addTimelineNote(
          orderId,
          'Stock hold expired; the units were returned to stock',
          order.status,
        );
      }
    } catch (err) {
      console.warn(`[sweeper] failed to close expired order ${orderId}:`, (err as Error).message);
    }
  }

  return { released: expired.length, cancelled };
}

export interface SweeperHandle {
  stop: () => void;
  /** Runs one sweep immediately; useful for tests and admin tooling. */
  sweepNow: (now?: Date) => Promise<SweepResult>;
}

/**
 * Starts the periodic sweep. The interval is deliberately short relative to the
 * TTL: a hold may overstay by at most one interval, never indefinitely.
 */
export function startReservationSweeper(options: { intervalMs?: number } = {}): SweeperHandle {
  const intervalMs =
    options.intervalMs ??
    (Number(process.env.RESERVATION_SWEEP_INTERVAL_MS) > 0
      ? Number(process.env.RESERVATION_SWEEP_INTERVAL_MS)
      : 60_000);

  let running = false;

  const sweepNow = async (now?: Date): Promise<SweepResult> => {
    // Guard against overlap: a slow sweep must not run concurrently with itself.
    if (running) return { released: 0, cancelled: 0 };
    running = true;
    try {
      const result = await sweepExpiredReservations(now);
      if (result.released > 0) {
        console.log(
          `[sweeper] released ${result.released} expired reservation(s), cancelled ${result.cancelled} order(s)`,
        );
      }
      return result;
    } catch (err) {
      console.warn('[sweeper] sweep failed:', (err as Error).message);
      return { released: 0, cancelled: 0 };
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void sweepNow(), intervalMs);
  // A background janitor must never keep the process alive on its own.
  timer.unref?.();

  return { stop: () => clearInterval(timer), sweepNow };
}
