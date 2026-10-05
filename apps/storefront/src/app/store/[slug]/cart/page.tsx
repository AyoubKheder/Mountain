'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ApiError, checkout, getStore, type PlacedOrder, type StoreSummary } from '../../../../lib/api';
import { formatMoney } from '../../../../lib/money';
import { useCart } from '../../../../lib/useCart';

type Step = 'cart' | 'details' | 'done';

export default function CartPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const { cart, loading, pending, error, setError, setQuantity, remove, clearLocal } = useCart(slug);
  const [store, setStore] = useState<StoreSummary | null>(null);
  const [step, setStep] = useState<Step>('cart');
  const [order, setOrder] = useState<PlacedOrder | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    customerEmail: '',
    customerName: '',
    line1: '',
    city: '',
    postalCode: '',
    country: 'TN',
    region: '',
    phone: '',
    paymentProvider: 'MOCK' as 'MOCK' | 'CASH_ON_DELIVERY',
  });

  useEffect(() => {
    getStore(slug).then(setStore).catch(() => undefined);
  }, [slug]);

  const accent = store?.themeSettings?.colors?.accent ?? '#1f5c45';

  async function placeOrder() {
    if (!cart) return;
    setSubmitting(true);
    setError(null);
    try {
      const placed = await checkout(slug, cart.id, {
        customerEmail: form.customerEmail,
        customerName: form.customerName || undefined,
        shippingAddress: {
          line1: form.line1,
          city: form.city,
          postalCode: form.postalCode,
          country: form.country,
          region: form.region || undefined,
          phone: form.phone || undefined,
        },
        paymentProvider: form.paymentProvider,
      });
      setOrder(placed);
      setStep('done');
      // The cart no longer exists on the server once it has become an order.
      clearLocal();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Stock moved while the shopper was deciding; say so plainly.
        setError(`${err.message} — reload the cart to see current availability.`);
      } else {
        setError(err instanceof Error ? err.message : 'Checkout failed');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="store-page">
        <section className="section">
          <div className="empty">Loading your cart…</div>
        </section>
      </main>
    );
  }

  if (step === 'done' && order) {
    return (
      <main className="store-page">
        <section className="section">
          <div className="success-card">
            <div className="success-icon">✓</div>
            <div className="eyebrow">Order confirmed</div>
            <h1>{order.orderNumber}</h1>
            <p>
              Thank you. A confirmation has been recorded for <strong>{order.customerEmail}</strong>.
            </p>
            <div className="setup-summary">
              <div className="setup-theme">
                <span>
                  <small>Status</small>
                  <strong>{order.status}</strong>
                </span>
              </div>
              <div className="setup-tools">
                <small>Payment</small>
                <div>
                  <span className="tool-pill">
                    {order.payment?.provider ?? 'none'} · {order.paymentStatus}
                  </span>
                </div>
              </div>
              <div className="setup-theme">
                <span>
                  <small>Total paid</small>
                  <strong>{formatMoney(order.totals.total)}</strong>
                </span>
              </div>
            </div>
            <div className="onboarding-actions">
              <a className="button" href={`/store/${slug}`}>
                Continue shopping
              </a>
              <a className="button secondary" href="/">
                Back to marketplace
              </a>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="store-page">
      <header className="nav">
        <a className="brand" href="/">
          <img className="brand-logo" src="/mountain-logo-cropped.jpg" alt="Mountain" /> mountain
        </a>
        <a className="view-link" href={`/store/${slug}`}>
          Back to {store?.name ?? 'store'}
        </a>
      </header>

      <section className="section">
        <div className="section-heading">
          <div>
            <h2>Your cart</h2>
            <p>
              {cart?.itemCount ?? 0} item{cart?.itemCount === 1 ? '' : 's'} from {store?.name ?? slug}
            </p>
          </div>
        </div>

        {!cart || cart.lines.length === 0 ? (
          <div className="empty">
            Your cart is empty. <a href={`/store/${slug}`}>Browse {store?.name ?? 'the store'}</a>.
          </div>
        ) : (
          <div className="cart-layout">
            <div className="cart-lines">
              {cart.lines.map((line) => (
                <article className="cart-line" key={line.id}>
                  <div className="cart-line-media" style={{ background: accent }}>
                    {line.title.charAt(0)}
                  </div>
                  <div className="cart-line-body">
                    <h3>
                      <a href={`/store/${slug}/product/${line.slug}`}>{line.title}</a>
                    </h3>
                    <span className="meta">SKU {line.sku}</span>
                    {line.quantity === 0 && <p className="form-error">Out of stock</p>}
                  </div>
                  <div className="cart-line-quantity">
                    <button
                      className="quantity-button"
                      onClick={() => setQuantity(line.id, Math.max(0, line.quantity - 1))}
                      disabled={pending}
                      aria-label={`Decrease quantity of ${line.title}`}
                    >
                      −
                    </button>
                    <span>{line.quantity}</span>
                    <button
                      className="quantity-button"
                      onClick={() => setQuantity(line.id, line.quantity + 1)}
                      disabled={pending}
                      aria-label={`Increase quantity of ${line.title}`}
                    >
                      +
                    </button>
                  </div>
                  <div className="cart-line-total">{formatMoney(line.lineTotal)}</div>
                  <button
                    className="text-button"
                    onClick={() => remove(line.id)}
                    disabled={pending}
                  >
                    Remove
                  </button>
                </article>
              ))}

              {!cart.available && (
                <p className="form-error">
                  Some items are no longer available in the requested quantity:{' '}
                  {cart.shortages.map((s) => `${s.sku} (${s.available} left)`).join(', ')}
                </p>
              )}
            </div>

            <aside className="cart-summary">
              <h3>Order summary</h3>
              <div className="summary-row">
                <span>Subtotal</span>
                <strong>{formatMoney(cart.totals.subtotal)}</strong>
              </div>
              <div className="summary-row">
                <span>Tax</span>
                <strong>{formatMoney(cart.totals.tax)}</strong>
              </div>
              <div className="summary-row">
                <span>Shipping</span>
                <strong>{formatMoney(cart.totals.shipping)}</strong>
              </div>
              <div className="summary-row total">
                <span>Total</span>
                <strong>{formatMoney(cart.totals.total)}</strong>
              </div>

              {step === 'cart' ? (
                <button className="button form-submit" onClick={() => setStep('details')}>
                  Checkout
                </button>
              ) : (
                <form
                  className="store-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    placeOrder();
                  }}
                >
                  <label>
                    Email
                    <input
                      required
                      type="email"
                      value={form.customerEmail}
                      onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
                      placeholder="you@example.com"
                    />
                  </label>
                  <label>
                    Full name<span className="label-hint">Optional</span>
                    <input
                      value={form.customerName}
                      onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                    />
                  </label>
                  <label>
                    Address
                    <input
                      required
                      value={form.line1}
                      onChange={(e) => setForm({ ...form, line1: e.target.value })}
                      placeholder="12 Rue de la Montagne"
                    />
                  </label>
                  <div className="field-row">
                    <label>
                      City
                      <input
                        required
                        value={form.city}
                        onChange={(e) => setForm({ ...form, city: e.target.value })}
                      />
                    </label>
                    <label>
                      Postal code
                      <input
                        required
                        value={form.postalCode}
                        onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
                      />
                    </label>
                  </div>
                  <div className="field-row">
                    <label>
                      Country
                      <input
                        required
                        value={form.country}
                        onChange={(e) => setForm({ ...form, country: e.target.value })}
                      />
                    </label>
                    <label>
                      Phone<span className="label-hint">Optional</span>
                      <input
                        value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      />
                    </label>
                  </div>
                  <label>
                    Payment
                    <select
                      value={form.paymentProvider}
                      onChange={(e) =>
                        setForm({ ...form, paymentProvider: e.target.value as 'MOCK' | 'CASH_ON_DELIVERY' })
                      }
                    >
                      <option value="MOCK">Card (test gateway)</option>
                      <option value="CASH_ON_DELIVERY">Cash on delivery</option>
                    </select>
                  </label>

                  <button className="button form-submit" type="submit" disabled={submitting}>
                    {submitting ? 'Placing order…' : `Pay ${formatMoney(cart.totals.total)}`}
                  </button>
                  <p className="form-note">
                    Stock is reserved when you place the order, and released if the payment fails.
                  </p>
                </form>
              )}

              {error && <p className="form-error">{error}</p>}
            </aside>
          </div>
        )}
      </section>
    </main>
  );
}
