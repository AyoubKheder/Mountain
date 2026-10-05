/**
 * Multi-tenancy isolation test — the regression gate for spec section 3.
 *
 * Mountain's founding rule is that one merchant must never see or touch another
 * merchant's data. Two vulnerabilities violated it (a storefront catalogue leak
 * and a cross-tenant store update), so this script pins the rule down.
 *
 * Both directions are covered for every check: the attack must be blocked *and*
 * the legitimate path must keep working, so a fix cannot silently break the
 * catalogue.
 *
 * Run: node scripts/verify-tenancy.mjs
 * Exits non-zero on the first failed assertion (usable as a CI gate).
 */

import { spawn } from 'node:child_process';

const PORT = 4137;
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

let failures = 0;

function assert(condition, label, detail) {
  if (condition) {
    console.log(`✓ ${label}${detail ? `  → ${detail}` : ''}`);
  } else {
    console.error(`✗ ${label}${detail ? `  → ${detail}` : ''}`);
    failures += 1;
  }
}

/**
 * Creates an isolated merchant: user, tenant, auto-provisioned store, and a
 * tenant-scoped access token (the register token has no tenant context yet).
 */
async function createMerchant(tag) {
  const email = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Sup3rSecure!';

  const reg = await api('POST', '/api/auth/register', {
    body: { email, password, firstName: tag, lastName: 'Tester' },
  });
  if (reg.status !== 201) throw new Error(`register failed for ${tag}: ${reg.status}`);

  const tenant = await api('POST', '/api/tenants', {
    token: reg.json.accessToken,
    body: { name: `${tag} Tenant`, storeName: `${tag} Store`, currency: 'USD' },
  });
  if (tenant.status !== 201) throw new Error(`tenant creation failed for ${tag}: ${tenant.status}`);

  const login = await api('POST', '/api/auth/login', { body: { email, password } });
  if (login.status !== 200) throw new Error(`login failed for ${tag}: ${login.status}`);

  return {
    token: login.json.accessToken,
    tenantId: tenant.json.tenant.id,
    storeId: tenant.json.store.id,
    storeSlug: tenant.json.store.slug,
  };
}

/** Creates a product and activates it, so it is a candidate for the public catalog. */
async function createActiveProduct(merchant, title, extra = {}) {
  const created = await api('POST', '/api/products', {
    token: merchant.token,
    body: { title, price: 25, currency: 'USD', ...extra },
  });
  if (created.status !== 201) throw new Error(`product creation failed: ${created.status}`);

  const activated = await api('PATCH', `/api/products/${created.json.id}`, {
    token: merchant.token,
    body: { status: 'ACTIVE' },
  });
  if (activated.json?.status !== 'ACTIVE') throw new Error('product activation failed');

  return created.json;
}

/** Creates a product and leaves it in DRAFT. */
async function createDraftProduct(merchant, title) {
  const created = await api('POST', '/api/products', {
    token: merchant.token,
    body: { title, price: 25, currency: 'USD' },
  });
  if (created.status !== 201) throw new Error(`draft creation failed: ${created.status}`);
  return created.json;
}

const server = spawn(
  process.execPath,
  ['node_modules/tsx/dist/cli.mjs', 'services/api/src/index.ts'],
  {
    stdio: 'ignore',
    env: {
      ...process.env,
      PORT: String(PORT),
      JWT_ACCESS_SECRET: 'tenancy-secret',
      JWT_REFRESH_SECRET: 'tenancy-refresh',
      // Unreachable on purpose: these checks must hold on the in-memory path too.
      MONGO_URI: 'mongodb://localhost:27999/mountain',
      REDIS_URL: 'redis://localhost:6390',
    },
  },
);

try {
  await waitForServer();

  const alpha = await createMerchant('alpha');
  const beta = await createMerchant('beta');

  // A product created through the normal flow carries no storeId.
  const unbound = await createActiveProduct(alpha, 'Alpha Unbound Cap');
  // A product explicitly bound to alpha's store.
  const bound = await createActiveProduct(alpha, 'Alpha Bound Boots', { storeId: alpha.storeId });
  // A draft must never surface publicly, even for its own tenant.
  await createDraftProduct(alpha, 'Alpha Draft Jacket');

  console.log('\n— Catalogue storefront —');

  const alphaCatalog = await api('GET', `/api/storefront/stores/${alpha.storeSlug}/products`);
  const alphaTitles = (alphaCatalog.json?.items ?? []).map((p) => p.title);

  assert(alphaTitles.includes('Alpha Unbound Cap'), 'legitimate: unbound product visible on its own store');
  assert(alphaTitles.includes('Alpha Bound Boots'), 'legitimate: store-bound product visible on its own store');
  assert(!alphaTitles.includes('Alpha Draft Jacket'), 'draft product never public');
  assert(
    (alphaCatalog.json?.items ?? []).every((p) => p.tenantId === alpha.tenantId),
    'every product returned to a store belongs to that store\'s tenant',
  );

  const betaCatalog = await api('GET', `/api/storefront/stores/${beta.storeSlug}/products`);
  const betaItems = betaCatalog.json?.items ?? [];
  assert(
    betaItems.every((p) => p.tenantId === beta.tenantId),
    'CROSS-TENANT: beta\'s storefront exposes no foreign product',
    `${betaItems.length} product(s)`,
  );
  assert(
    !betaItems.some((p) => p.title === 'Alpha Unbound Cap'),
    'CROSS-TENANT: the unbound-product leak stays closed',
  );

  const leakBySlug = await api(
    'GET',
    `/api/storefront/stores/${beta.storeSlug}/products/${unbound.slug}`,
  );
  assert(leakBySlug.status === 404, 'CROSS-TENANT: foreign product unreachable by direct slug', `HTTP ${leakBySlug.status}`);

  const ownBySlug = await api(
    'GET',
    `/api/storefront/stores/${alpha.storeSlug}/products/${unbound.slug}`,
  );
  assert(ownBySlug.status === 200, 'legitimate: product detail reachable on its own store', `HTTP ${ownBySlug.status}`);

  console.log('\n— Store settings —');

  const hijack = await api('PATCH', `/api/stores/${alpha.storeId}`, {
    token: beta.token,
    body: { name: 'Hijacked Store' },
  });
  assert(hijack.status === 404, 'CROSS-TENANT: patching a foreign store is refused', `HTTP ${hijack.status}`);

  const afterHijack = await api('GET', '/api/stores', { token: alpha.token });
  assert(
    afterHijack.json?.items?.[0]?.name !== 'Hijacked Store',
    'CROSS-TENANT: the target store is left untouched',
    `name="${afterHijack.json?.items?.[0]?.name}"`,
  );

  const injectTenant = await api('PATCH', `/api/stores/${alpha.storeId}`, {
    token: alpha.token,
    body: { tenantId: beta.tenantId, name: 'Alpha Renamed' },
  });
  assert(
    injectTenant.status === 200 && injectTenant.json?.tenantId === alpha.tenantId,
    'tenantId cannot be re-assigned through the request body',
    `tenantId ${injectTenant.json?.tenantId === alpha.tenantId ? 'unchanged' : 'CORRUPTED'}`,
  );

  const ghost = await api('PATCH', '/api/stores/does-not-exist', {
    token: alpha.token,
    body: { name: 'Ghost Store' },
  });
  assert(ghost.status === 404, 'unknown store id returns 404 (no upsert)', `HTTP ${ghost.status}`);

  const summary = failures === 0
    ? '\nTENANCY ISOLATION PASSED'
    : `\nTENANCY ISOLATION FAILED (${failures} assertion(s))`;
  console.log(summary);
  if (failures > 0) process.exitCode = 1;
} catch (err) {
  console.error('Tenancy test error:', err);
  process.exitCode = 1;
} finally {
  server.kill();
}
