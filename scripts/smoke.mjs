/**
 * End-to-end smoke test for the Mountain API scaffold.
 *
 * Boots the API on a scratch port (no Mongo/Redis needed for these routes),
 * then exercises: register → create tenant (provisions store + OWNER role) →
 * login (tenant-scoped token) → create/activate product → create order →
 * transition → payment → refund.
 *
 * Run: node scripts/smoke.mjs
 */

import { spawn } from 'node:child_process';

const PORT = 4123;
const BASE = `http://localhost:${PORT}`;

function waitForServer(timeoutMs = 15000) {
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

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
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

function assert(condition, label) {
  if (!condition) {
    console.error(`✗ ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ ${label}`);
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
      JWT_ACCESS_SECRET: 'smoke-secret',
      JWT_REFRESH_SECRET: 'smoke-refresh',
      MONGO_URI: 'mongodb://localhost:27999/mountain',
      REDIS_URL: 'redis://localhost:6390',
    },
  },
);

try {
  await waitForServer();

  const email = `smoke-${Date.now()}@example.com`;
  const password = 'Sup3rSecure!';

  // 1. Register
  const reg = await api('POST', '/api/auth/register', {
    body: { email, password, firstName: 'Smoke', lastName: 'Tester' },
  });
  assert(reg.status === 201, 'register returns 201 with tokens');
  const anonToken = reg.json.accessToken;

  // 2. Create tenant (provisions store + OWNER membership)
  const tenant = await api('POST', '/api/tenants', {
    token: anonToken,
    body: { name: 'Smoke Tenant', storeName: 'Smoke Store', currency: 'USD' },
  });
  assert(tenant.status === 201, 'tenant creation returns 201');
  assert(tenant.json?.store?.slug === 'smoke-store', 'store auto-provisioned with slug');
  assert(tenant.json?.permissions?.includes('*'), 'OWNER gets wildcard permissions');
  const tenantId = tenant.json.tenant.id;

  // 3. Re-login to get a tenant-scoped token
  const login = await api('POST', '/api/auth/login', {
    body: { email, password },
  });
  assert(login.status === 200, 'login returns 200');
  const token = login.json.accessToken;

  // 4. Tenant isolation: no tenant context without membership token? (token has tenantId)
  const productsNoAuth = await api('GET', '/api/products');
  assert(productsNoAuth.status === 401, 'products require authentication');

  // 5. Create + activate product
  const product = await api('POST', '/api/products', {
    token,
    headers: {},
    body: { title: 'Trail Backpack 40L', price: 129.9, currency: 'USD' },
  });
  assert(product.status === 201, 'product creation returns 201');
  assert(product.json?.sku?.startsWith('SKU-'), 'product SKU auto-generated');

  const activated = await api('PATCH', `/api/products/${product.json.id}`, {
    token,
    body: { status: 'ACTIVE' },
  });
  assert(activated.json?.status === 'ACTIVE', 'product activated for purchase');

  // 6. Create order
  const order = await api('POST', '/api/orders', {
    token,
    body: {
      items: [{ productId: product.json.id, quantity: 2 }],
      taxRate: 0.1,
      shippingAmount: 5,
    },
  });
  assert(order.status === 201, 'order creation returns 201');
  const expectedTotal = +(129.9 * 2 * 1.1 + 5).toFixed(2);
  assert(order.json?.totals?.total?.amount === expectedTotal, `order totals correct (${expectedTotal})`);
  assert(order.json?.status === 'PENDING', 'order starts as PENDING');

  // 7. Illegal transition rejected
  const badTransition = await api('POST', `/api/orders/${order.json.id}/transition`, {
    token,
    body: { status: 'DELIVERED' },
  });
  assert(badTransition.status === 409, 'PENDING → DELIVERED rejected by state machine');

  // 8. Valid transition
  const confirm = await api('POST', `/api/orders/${order.json.id}/transition`, {
    token,
    body: { status: 'CONFIRMED' },
  });
  assert(confirm.status === 200 && confirm.json.status === 'CONFIRMED', 'PENDING → CONFIRMED works');

  // 9. Payment + refund via mock provider
  const payment = await api('POST', '/api/payments', {
    token,
    body: { orderId: order.json.id, amount: expectedTotal, currency: 'USD' },
  });
  assert(payment.status === 201 && payment.json.status === 'SUCCEEDED', 'mock payment succeeds');

  const refund = await api('POST', `/api/payments/${payment.json.id}/refund`, {
    token,
    body: {},
  });
  assert(refund.status === 200 && refund.json.status === 'REFUNDED', 'payment refunded');

  // 10. Refresh token flow
  const refresh = await api('POST', '/api/auth/refresh', {
    body: { refreshToken: reg.json.refreshToken },
  });
  assert(refresh.status === 200 && refresh.json.accessToken, 'refresh token rotation works');

  console.log(process.exitCode ? '\nSMOKE TEST FAILED' : '\nSMOKE TEST PASSED');
} catch (err) {
  console.error('Smoke test error:', err);
  process.exitCode = 1;
} finally {
  server.kill();
}
