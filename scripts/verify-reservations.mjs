#!/usr/bin/env node
/**
 * Reservation-expiry verification.
 *
 * Proves the one thing a TTL cannot prove by itself: that an abandoned checkout
 * actually gives its stock back. The script boots its own API instance with a
 * deliberately tiny reservation TTL and sweep interval, places a cash-on-delivery
 * order (which by design stays PENDING with the stock held, waiting for money
 * that never comes), then asserts that the sweeper cancels the order and returns
 * the units.
 *
 * Run with: npm run test:reservations
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.RESERVATIONS_PORT ?? 4211);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const BASE = `${ORIGIN}/api`;

const RESERVATION_TTL_MS = 1500;
const SWEEP_INTERVAL_MS = 400;

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function api(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, body: json };
}

async function waitForApi(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // /health is mounted at the root, not under /api.
      const response = await fetch(`${ORIGIN}/health`);
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

async function main() {
  console.log('\n[reservations] starting API with a 1.5s reservation TTL…');

  const server = spawn(
    'npm',
    ['run', 'dev', '-w', 'services/api'],
    {
      cwd: ROOT,
      // Its own process group, so the whole tree (npm → tsx → node) can be
      // taken down at the end. A surviving orphan would keep the port and make
      // the *next* run talk to a stale in-memory store.
      detached: true,
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: 'test',
        LOG_LEVEL: 'warn',
        RESERVATION_TTL_MS: String(RESERVATION_TTL_MS),
        COD_RESERVATION_TTL_MS: String(RESERVATION_TTL_MS),
        RESERVATION_SWEEP_INTERVAL_MS: String(SWEEP_INTERVAL_MS),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const logs = [];
  server.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  server.stderr.on('data', (chunk) => logs.push(chunk.toString()));

  const shutdown = () => {
    if (server.pid) {
      try {
        process.kill(-server.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
  };

  // A leftover server on this port would answer the health probe while holding
  // completely different in-memory state, which produces baffling failures.
  try {
    const occupied = await fetch(`${ORIGIN}/health`);
    if (occupied.ok) {
      console.error(
        `[reservations] port ${PORT} is already serving a healthy API — refusing to run against unknown state. ` +
          'Free the port (or set RESERVATIONS_PORT) and retry.',
      );
      shutdown();
      process.exit(1);
    }
  } catch {
    /* nothing listening: exactly what we want */
  }

  try {
    if (!(await waitForApi())) {
      console.error('[reservations] API never became healthy. Log tail:\n', logs.join('').slice(-2000));
      process.exit(1);
    }

    const stamp = Date.now().toString(36);

    // --- A merchant with one stocked product ---------------------------------
    const registered = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: `sweep-${stamp}@mountain.test`,
        password: 'SweepMerchant123!',
        firstName: 'Sweep',
        lastName: 'Tester',
      }),
    });
    const token = registered.body?.accessToken;
    check('merchant registered', Boolean(token), JSON.stringify(registered.body));

    const tenant = await api('/tenants', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: `Sweep Store ${stamp}`,
        storeName: `Sweep Store ${stamp}`,
        industry: 'fashion',
      }),
    });
    const storeId = tenant.body?.store?.id;
    const storeSlug = tenant.body?.store?.slug;
    const tenantToken = tenant.body?.accessToken ?? token;
    check('store provisioned', Boolean(storeId && storeSlug), JSON.stringify(tenant.body));

    await api(`/stores/${storeId}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${tenantToken}` },
      body: JSON.stringify({ published: true, taxRate: 0, shippingFlatRate: 0 }),
    });

    const product = await api('/products', {
      method: 'POST',
      headers: { authorization: `Bearer ${tenantToken}` },
      body: JSON.stringify({
        title: 'Sweep Test Product',
        description: 'Used to prove that expired holds return their stock.',
        price: 20,
        currency: 'USD',
      }),
    });
    const productId = product.body?.id;
    const variantId = product.body?.variants?.[0]?.id;
    check('product created', Boolean(productId && variantId), JSON.stringify(product.body));

    await api(`/products/${productId}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${tenantToken}` },
      body: JSON.stringify({ status: 'ACTIVE' }),
    });

    await api(`/inventory/${productId}/${variantId}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${tenantToken}` },
      body: JSON.stringify({ stock: 3, lowStockThreshold: 1 }),
    });

    const seeded = await api(`/inventory/${productId}/${variantId}`, {
      headers: { authorization: `Bearer ${tenantToken}` },
    });
    check('inventory seeded with 3 units', seeded.body?.stock === 3, JSON.stringify(seeded.body));

    // --- An abandoned cash-on-delivery order --------------------------------
    const cart = await api(`/storefront/stores/${storeSlug}/carts`, {
      method: 'POST',
      body: JSON.stringify({ sessionId: `sweep_${stamp}` }),
    });
    await api(`/storefront/stores/${storeSlug}/carts/${cart.body.id}/lines`, {
      method: 'POST',
      body: JSON.stringify({ productId, quantity: 2 }),
    });

    const order = await api(`/storefront/stores/${storeSlug}/checkout`, {
      method: 'POST',
      headers: { 'idempotency-key': `sweep_${stamp}` },
      body: JSON.stringify({
        cartId: cart.body.id,
        customerEmail: `abandoned-${stamp}@mountain.test`,
        paymentProvider: 'CASH_ON_DELIVERY',
        shippingAddress: { line1: '1 Rue du Test', city: 'Hammamet', postalCode: '8050', country: 'TN' },
      }),
    });
    const orderId = order.body?.orderId;
    check('cash-on-delivery order placed', order.body?.status === 'PENDING', JSON.stringify(order.body));

    const heldInventory = (await api(`/inventory/${productId}/${variantId}`, {
      headers: { authorization: `Bearer ${tenantToken}` },
    })).body;
    check(
      'stock is held while the order waits for payment (2 reserved)',
      heldInventory?.reserved === 2 && heldInventory?.available === 1,
      JSON.stringify(heldInventory),
    );

    // --- The sweep ----------------------------------------------------------
    console.log(`[reservations] waiting for the ${RESERVATION_TTL_MS}ms TTL to lapse…`);
    const deadline = Date.now() + 15_000;
    let releasedInventory;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const current = (await api(`/inventory/${productId}/${variantId}`, {
        headers: { authorization: `Bearer ${tenantToken}` },
      })).body;
      if (current?.reserved === 0) {
        releasedInventory = current;
        break;
      }
    }

    check(
      'expired hold was released automatically (reserved back to 0)',
      releasedInventory?.reserved === 0,
      JSON.stringify(releasedInventory),
    );
    check(
      'the units are sellable again (available back to 3)',
      releasedInventory?.available === 3,
      JSON.stringify(releasedInventory),
    );
    check(
      'stock was not decremented — nothing was sold',
      releasedInventory?.stock === 3,
      JSON.stringify(releasedInventory),
    );

    const closed = await api(`/orders/${orderId}`, {
      headers: { authorization: `Bearer ${tenantToken}` },
    });
    check(
      'the abandoned order was cancelled by the sweeper',
      closed.body?.status === 'CANCELLED',
      JSON.stringify(closed.body?.status),
    );
    check(
      'the timeline explains why',
      Boolean(
        closed.body?.timeline?.some((entry) => /expired/i.test(entry.note ?? '')),
      ),
      JSON.stringify(closed.body?.timeline),
    );

    // A released hold must not come back: a second sweep is a no-op.
    const afterSecondSweep = (await api(`/inventory/${productId}/${variantId}`, {
      headers: { authorization: `Bearer ${tenantToken}` },
    })).body;
    check(
      'sweeping again is idempotent (still 3 available, 0 reserved)',
      afterSecondSweep?.available === 3 && afterSecondSweep?.reserved === 0,
      JSON.stringify(afterSecondSweep),
    );

    const newCart = await api(`/storefront/stores/${storeSlug}/carts`, {
      method: 'POST',
      body: JSON.stringify({ sessionId: `sweep_after_${stamp}` }),
    });
    const afterRelease = await api(`/storefront/stores/${storeSlug}/carts/${newCart.body.id}/lines`, {
      method: 'POST',
      body: JSON.stringify({ productId, quantity: 3 }),
    });
    check(
      'the released units can now be bought (3 added to a cart)',
      [200, 201].includes(afterRelease.status) && afterRelease.body?.itemCount === 3,
      `HTTP ${afterRelease.status} ${JSON.stringify(afterRelease.body?.error ?? afterRelease.body?.itemCount)}`,
    );
  } catch (err) {
    failed += 1;
    console.error('[reservations] unexpected error:', err);
    console.error(logs.join('').slice(-2000));
  } finally {
    shutdown();
  }

  const sweepLogs = logs
    .join('')
    .split('\n')
    .filter((line) => /sweeper|orders\]/.test(line));
  if (sweepLogs.length) {
    console.log('[reservations] API sweeper log:');
    for (const line of sweepLogs) console.log(`  | ${line}`);
  }

  if (failed > 0) {
    console.log('[reservations] API log tail:');
    for (const line of logs.join('').split('\n').slice(-25)) console.log(`  | ${line}`);
  }

  console.log(`\n[reservations] ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 && passed > 0 ? 0 : 1);
}

main();
