/**
 * Payment provider registry bootstrap.
 *
 * Providers are registered *by configuration*, not by hardcoded lists: the mock
 * is always available for local development, and Stripe joins the registry only
 * when a secret key is present. The checkout then asks the registry what it can
 * settle, so enabling Stripe is a matter of setting `STRIPE_SECRET_KEY` — no code
 * change, and no path that silently records an unpaid order.
 *
 * This also removes the previous side-effect-at-import style, which meant the
 * registry was only populated if the payments routes module happened to load.
 */

import { registerPaymentProvider, listPaymentProviders } from '../payments.provider.js';
import { MockPaymentProvider } from './mock.provider.js';
import { StripePaymentProvider } from './stripe.provider.js';

let bootstrapped = false;

export function bootstrapPaymentProviders(): string[] {
  if (bootstrapped) return listPaymentProviders();
  bootstrapped = true;

  // Always available: lets the whole stack be exercised without credentials.
  registerPaymentProvider(new MockPaymentProvider());

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey && stripeKey.startsWith('sk_') && !stripeKey.includes('xxx')) {
    try {
      registerPaymentProvider(new StripePaymentProvider(stripeKey));
      console.log('[payments] Stripe provider registered (STRIPE_SECRET_KEY is set)');
    } catch (err) {
      console.warn('[payments] Stripe provider could not be registered:', (err as Error).message);
    }
  } else {
    console.log('[payments] STRIPE_SECRET_KEY not set — Stripe checkout is unavailable');
  }

  return listPaymentProviders();
}

/** Providers checkout can actually settle with right now. */
export function availableProviders(): string[] {
  return bootstrapPaymentProviders();
}

export function isProviderAvailable(id: string): boolean {
  return availableProviders().includes(id);
}
