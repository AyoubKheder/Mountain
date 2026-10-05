/**
 * Commerce invariants test — the guard for docs/shopify-benchmark.md §5.
 *
 * These are the things that separate a demo storefront from a platform that can
 * take money: never oversell, never double-charge on a retry, always attribute
 * an order to a customer, and never let the client decide what it pays.
 *
 * Each check asserts the user-visible outcome *and* the underlying stock, so a
 * "fix" that simply refuses everything cannot pass.
 *
 * Run: node scripts/verify-commerce.mjs
 */

import { spawn } from 'node:child_process';

const PORT = 4141;
const BASE = `http://localhost:${PORT}`;

function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const res = await fetch(`${BASE}/health`);
        if (res.ok) return resolve();
      } catch {
        // not up yet
      }
      if (Date.now() - start > timeoutMs) return reject(new Error('API did not start in time'));
      setTimeout(attempt, 300);
    };
    attempt();
  });
}

async function api(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

let failures = 0;
function assert(condition, label, detail) {
  if (condition) console.log(`✓ ${label}${detail ? `  → ${detail}` : ''}`);
  else {
    console.error(`✗ ${label}${detail ? `  → ${detail}` : ''}`);
    failures += 1;
  }
}

const server = spawn(
  process.execPath,
  ['node_modules/tsx/dist/cli.mjs', 'services/api/src/index.ts'],
  {
    stdio: 'ignore',
    env: {
      ...process.env,
      PORT: String(PORT),
      JWT_ACCESS_SECRET: 'commerce-secret',
      JWT_REFRESH_SECRET: 'commerce-refresh',
      MONGO_URI: 'mongodb://localhost:27999/mountain',
      REDIS_URL: 'redis://localhost:6390',
    },
  },
);

/** Boots a merchant, a store, a stocked product, and returns handy handles. */
async function setupMerchant(tag, { stock, taxRate = 0, shippingFlatRate = 0, price = 100 } = {}) {
  const email = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const password = 'Sup3rSecure!';

  const reg = await api('POST', '/api/auth/register', {
    body: { email, password, firstName: tag, lastName: 'Merchant' },
  });
  const tenant = await api('POST', '/api/tenants', {
    token: reg.json.accessToken,
    body: { name: `${tag} Tenant`, storeName: `${tag} Store`, currency: 'USD' },
  });
  const login = await api('POST', '/api/auth/login', { body: { email, password } });
  const token = login.json.accessToken;
  const storeId = tenant.json.store.id;
  const storeSlug = tenant.json.store.slug;

  if (taxRate || shippingFlatRate) {
    await api('PATCH', `/api/stores/${storeId}`, { token, body: { taxRate, shippingFlatRate } });
  }

  const product = await api('POST', '/api/products', {
    token,
    body: { title: `${tag} Widget`, price, currency: 'USD' },
  });
  await api('PATCH', `/api/products/${product.json.id}`, { token, body: { status: 'ACTIVE' } });
  const variantId = product.json.variants[0].id;

  if (stock !== undefined) {
    await api('PUT', `/api/inventory/${product.json.id}/${variantId}`, { token, body: { stock } });
  }

  return { token, storeId, storeSlug, productId: product.json.id, variantId };
}

async function available(token, productId, variantId) {
  const res = await api('GET', `/api/inventory/${productId}/${variantId}`, { token });
  return res.json?.available;
}

const shipping = {
  line1: '12 Rue de la Montagne',
  city: 'Tunis',
  postalCode: '1000',
  country: 'TN',
};

function checkoutBody(productId, quantity, extra = {}) {
  return {
    customerEmail: extra.customerEmail ?? 'shopper@example.com',
    shippingAddress: shipping,
    items: [{ productId, quantity }],
    ...extra,
  };
}

try {
  await waitForServer();

  // ---------------------------------------------------------------- overselling
  console.log('\n— Ne jamais survendre —');
  const m1 = await setupMerchant('stock', { stock: 10, taxRate: 0.1, shippingFlatRate: 5 });

  const tooMany = await api('POST', `/api/storefront/stores/${m1.storeSlug}/checkout`, {
    body: checkoutBody(m1.productId, 11),
  });
  assert(tooMany.status === 409, 'checkout above available stock is refused', `HTTP ${tooMany.status}`);
  assert(
    (tooMany.json?.error ?? '').includes('Insufficient stock'),
    'the refusal explains the shortage',
    tooMany.json?.error,
  );

  const afterRefusal = await api('GET', '/api/orders', { token: m1.token });
  assert(afterRefusal.json?.total === 0, 'a refused checkout creates no order', `${afterRefusal.json?.total} order(s)`);
  assert((await available(m1.token, m1.productId, m1.variantId)) === 10, 'a refused checkout holds no stock');

  // ------------------------------------------------------------- happy path
  console.log('\n— Vente normale —');
  const sale = await api('POST', `/api/storefront/stores/${m1.storeSlug}/checkout`, {
    body: checkoutBody(m1.productId, 2),
  });
  assert(sale.status === 201, 'checkout succeeds', `HTTP ${sale.status}`);
  assert(sale.json?.status === 'CONFIRMED', 'paid order is CONFIRMED', sale.json?.status);
  assert(sale.json?.paymentStatus === 'PAID', 'order is marked PAID', sale.json?.paymentStatus);
  assert((await available(m1.token, m1.productId, m1.variantId)) === 8, 'stock decremented on payment', '10 → 8');

  const expectedSubtotal = 200;
  assert(sale.json?.totals?.subtotal?.amount === expectedSubtotal, 'subtotal computed server-side', `$${sale.json?.totals?.subtotal?.amount}`);
  assert(sale.json?.totals?.tax?.amount === 20, 'tax comes from the store settings', `$${sale.json?.totals?.tax?.amount}`);
  assert(sale.json?.totals?.shipping?.amount === 5, 'shipping comes from the store settings', `$${sale.json?.totals?.shipping?.amount}`);
  assert(sale.json?.totals?.total?.amount === 225, 'total = subtotal + tax + shipping', `$${sale.json?.totals?.total?.amount}`);

  // ------------------------------------------------------------- idempotence
  console.log('\n— Idempotence —');
  const key = `idem-${Date.now()}`;
  const first = await api('POST', `/api/storefront/stores/${m1.storeSlug}/checkout`, {
    body: checkoutBody(m1.productId, 1),
    headers: { 'Idempotency-Key': key },
  });
  const second = await api('POST', `/api/storefront/stores/${m1.storeSlug}/checkout`, {
    body: checkoutBody(m1.productId, 1),
    headers: { 'Idempotency-Key': key },
  });
  assert(first.status === 201, 'first attempt creates the order');
  assert(second.status === 200 && second.json?.replayed === true, 'retry replays instead of reselling', `HTTP ${second.status}`);
  assert(second.json?.orderId === first.json?.orderId, 'the retry returns the same order', second.json?.orderId === first.json?.orderId ? 'same orderId' : 'DIFFERENT');
  assert((await available(m1.token, m1.productId, m1.variantId)) === 7, 'a replayed retry does not decrement stock twice', 'available 7');

  // ------------------------------------------------- concurrent last unit
  console.log('\n— Concurrence sur la dernière unité —');
  const m2 = await setupMerchant('race', { stock: 1 });
  const attempts = await Promise.all(
    [1, 2].map(() =>
      api('POST', `/api/storefront/stores/${m2.storeSlug}/checkout`, {
        body: checkoutBody(m2.productId, 1, { customerEmail: `racer${Math.random()}@example.com` }),
      }),
    ),
  );
  const created = attempts.filter((a) => a.status === 201).length;
  const refused = attempts.filter((a) => a.status === 409).length;
  assert(created === 1 && refused === 1, 'two simultaneous checkouts of the last unit: exactly one wins', `${created} created / ${refused} refused`);
  assert((await available(m2.token, m2.productId, m2.variantId)) === 0, 'the last unit is gone, not oversold', 'available 0');

  // -------------------------------------------------------- provider guarding
  console.log('\n— Fournisseurs de paiement —');
  const m3 = await setupMerchant('provider', { stock: 5 });
  const stripe = await api('POST', `/api/storefront/stores/${m3.storeSlug}/checkout`, {
    body: checkoutBody(m3.productId, 1, { paymentProvider: 'STRIPE' }),
  });
  assert(stripe.status === 501, 'an unimplemented provider is refused loudly', `HTTP ${stripe.status}`);
  assert(
    (stripe.json?.error ?? '').includes('not available'),
    'the error says what is missing and which providers are configured',
    stripe.json?.error,
  );
  assert((await available(m3.token, m3.productId, m3.variantId)) === 5, 'a refused provider holds no stock');

  // ---------------------------------------------------- cash on delivery
  console.log('\n— Paiement à la livraison —');
  const cod = await api('POST', `/api/storefront/stores/${m3.storeSlug}/checkout`, {
    body: checkoutBody(m3.productId, 2, { paymentProvider: 'CASH_ON_DELIVERY' }),
  });
  assert(cod.status === 201 && cod.json?.status === 'PENDING', 'COD order is created as PENDING', cod.json?.status);
  assert(cod.json?.paymentStatus === 'PENDING', 'COD is not marked paid', cod.json?.paymentStatus);
  assert((await available(m3.token, m3.productId, m3.variantId)) === 3, 'COD holds stock without consuming it', '5 → 3 available, 5 still on hand');

  const cancelled = await api('POST', `/api/orders/${cod.json.orderId}/transition`, {
    token: m3.token,
    body: { status: 'CANCELLED', note: 'customer changed their mind' },
  });
  assert(cancelled.status === 200, 'the merchant can cancel a COD order');
  assert((await available(m3.token, m3.productId, m3.variantId)) === 5, 'cancelling releases the held stock', 'back to 5 available');

  // ------------------------------------------------------------- customers
  console.log('\n— Clients —');
  // By this point m1 has had two successful checkouts (the plain sale and the
  // first idempotent attempt) plus one refused one for the same shopper.
  const customerList = await api('GET', '/api/customers', { token: m1.token });
  assert(customerList.json?.total === 1, 'the shopper is one record, not one per attempt', `${customerList.json?.total} customer(s)`);

  const shopper = customerList.json.items.find((c) => c.email === 'shopper@example.com');
  assert(Boolean(shopper), 'the guest shopper is recorded, not discarded', shopper?.email);
  assert(shopper?.ordersCount === 2, 'only real orders count towards lifetime value', `${shopper?.ordersCount} order(s)`);
  assert(shopper?.totalSpent?.amount === 340, 'lifetime value sums the orders', `$${shopper?.totalSpent?.amount}`);

  const history = await api('GET', `/api/customers/${shopper.id}/orders`, { token: m1.token });
  assert(history.json?.total === 2, 'order history is queryable per customer', `${history.json?.total} order(s)`);

  // -------------------------------------------------- server-side pricing
  console.log('\n— Le client ne décide pas du prix —');
  const tampered = await api('POST', `/api/storefront/stores/${m1.storeSlug}/checkout`, {
    body: checkoutBody(m1.productId, 1, { taxRate: 0, shippingAmount: 0, total: 0 }),
  });
  assert(tampered.status === 201, 'a checkout with forged pricing fields still succeeds');
  assert(tampered.json?.totals?.tax?.amount === 10, 'client-supplied taxRate is ignored', `tax $${tampered.json?.totals?.tax?.amount}`);
  assert(tampered.json?.totals?.shipping?.amount === 5, 'client-supplied shipping is ignored', `shipping $${tampered.json?.totals?.shipping?.amount}`);

  // ------------------------------------------------------------------- cart
  console.log('\n— Panier persistant —');
  const m4 = await setupMerchant('cart', { stock: 5, taxRate: 0.2, shippingFlatRate: 3, price: 40 });

  const cartCreated = await api('POST', `/api/storefront/stores/${m4.storeSlug}/carts`, {
    body: { sessionId: 'session-abc-123' },
  });
  assert(cartCreated.status === 201, 'a cart can be created without a merchant token', `HTTP ${cartCreated.status}`);
  const cartId = cartCreated.json?.id;
  assert(cartCreated.json?.itemCount === 0, 'a new cart is empty');

  const added = await api('POST', `/api/storefront/stores/${m4.storeSlug}/carts/${cartId}/lines`, {
    body: { productId: m4.productId, quantity: 2 },
  });
  assert(added.status === 201 && added.json?.itemCount === 2, 'a line can be added', `${added.json?.itemCount} item(s)`);
  assert(added.json?.lines?.[0]?.title?.includes('cart Widget'), 'the cart returns product data, not just ids', added.json?.lines?.[0]?.title);
  assert(added.json?.totals?.subtotal?.amount === 80, 'cart subtotal is computed', `$${added.json?.totals?.subtotal?.amount}`);
  assert(added.json?.totals?.tax?.amount === 16 && added.json?.totals?.shipping?.amount === 3, 'cart totals include store tax and shipping');
  assert(added.json?.available === true, 'the cart reports live availability');

  const reloaded = await api('GET', `/api/storefront/stores/${m4.storeSlug}/carts/${cartId}`);
  assert(reloaded.json?.itemCount === 2, 'the cart survives a reload', `${reloaded.json?.itemCount} item(s)`);

  const overAdd = await api('POST', `/api/storefront/stores/${m4.storeSlug}/carts/${cartId}/lines`, {
    body: { productId: m4.productId, quantity: 4 },
  });
  assert(overAdd.status === 409, 'adding beyond stock is refused (2 + 4 > 5)', `HTTP ${overAdd.status}`);

  const lineId = added.json.lines[0].id;
  const updated = await api('PATCH', `/api/storefront/stores/${m4.storeSlug}/carts/${cartId}/lines/${lineId}`, {
    body: { quantity: 3 },
  });
  assert(updated.json?.itemCount === 3, 'a line quantity can be updated', `${updated.json?.itemCount} item(s)`);
  assert(updated.json?.totals?.subtotal?.amount === 120, 'totals follow the new quantity', `$${updated.json?.totals?.subtotal?.amount}`);

  const removed = await api('DELETE', `/api/storefront/stores/${m4.storeSlug}/carts/${cartId}/lines/${lineId}`);
  assert(removed.json?.itemCount === 0, 'a line can be removed', `${removed.json?.itemCount} item(s)`);

  // Re-add, then buy the cart: the order must come from the cart, not the body.
  await api('POST', `/api/storefront/stores/${m4.storeSlug}/carts/${cartId}/lines`, {
    body: { productId: m4.productId, quantity: 2 },
  });
  const cartCheckout = await api('POST', `/api/storefront/stores/${m4.storeSlug}/checkout`, {
    body: { cartId, customerEmail: 'cart-buyer@example.com', shippingAddress: shipping },
  });
  assert(cartCheckout.status === 201, 'a cart can be checked out', `HTTP ${cartCheckout.status}`);
  assert(cartCheckout.json?.totals?.total?.amount === 99, 'the order total comes from the cart', `$${cartCheckout.json?.totals?.total?.amount}`);
  assert((await available(m4.token, m4.productId, m4.variantId)) === 3, 'buying the cart consumed its stock', '5 → 3');

  const consumed = await api('GET', `/api/storefront/stores/${m4.storeSlug}/carts/${cartId}`);
  assert(consumed.status === 404, 'the cart is consumed by the order, not left dangling', `HTTP ${consumed.status}`);

  // A rejected checkout must leave the basket intact.
  const bigCart = await api('POST', `/api/storefront/stores/${m4.storeSlug}/carts`, { body: {} });
  const bigCartId = bigCart.json.id;
  await api('POST', `/api/storefront/stores/${m4.storeSlug}/carts/${bigCartId}/lines`, {
    body: { productId: m4.productId, quantity: 3 },
  });
  await api('PUT', `/api/inventory/${m4.productId}/${m4.variantId}`, { token: m4.token, body: { stock: 1 } });
  const refusedCart = await api('POST', `/api/storefront/stores/${m4.storeSlug}/checkout`, {
    body: { cartId: bigCartId, customerEmail: 'cart-buyer@example.com', shippingAddress: shipping },
  });
  assert(refusedCart.status === 409, 'checkout is refused when stock vanished meanwhile', `HTTP ${refusedCart.status}`);
  const stillThere = await api('GET', `/api/storefront/stores/${m4.storeSlug}/carts/${bigCartId}`);
  assert(stillThere.status === 200 && stillThere.json?.itemCount === 3, 'a refused checkout keeps the basket intact');

  // Claiming merges instead of discarding.
  const anonCart = await api('POST', `/api/storefront/stores/${m4.storeSlug}/carts`, { body: {} });
  await api('POST', `/api/storefront/stores/${m4.storeSlug}/carts/${anonCart.json.id}/lines`, {
    body: { productId: m4.productId, quantity: 1 },
  });
  const claimed = await api('POST', `/api/storefront/stores/${m4.storeSlug}/carts/${anonCart.json.id}/claim`, {
    body: { customerId: 'customer-xyz' },
  });
  assert(claimed.status === 200 && claimed.json?.customerId === 'customer-xyz', 'an anonymous cart can be claimed');
  const claimedAgain = await api('POST', `/api/storefront/stores/${m4.storeSlug}/carts/${anonCart.json.id}/claim`, {
    body: { customerId: 'customer-xyz' },
  });
  assert(claimedAgain.json?.itemCount === 1, 'claiming twice does not duplicate lines', `${claimedAgain.json?.itemCount} item(s)`);

  // ------------------------------------------------------- low stock report
  console.log('\n— Alertes de stock —');
  const lowStock = await api('GET', '/api/inventory?lowStockOnly=true', { token: m2.token });
  assert(lowStock.json?.total === 1, 'the low-stock worklist surfaces what needs reordering', `${lowStock.json?.total} item(s)`);

  const summary = failures === 0
    ? '\nCOMMERCE INVARIANTS PASSED'
    : `\nCOMMERCE INVARIANTS FAILED (${failures} assertion(s))`;
  console.log(summary);
  if (failures > 0) process.exitCode = 1;
} catch (err) {
  console.error('Commerce test error:', err);
  process.exitCode = 1;
} finally {
  server.kill();
}
