/**
 * Seeds demo merchants through the public API only.
 *
 * The storefront used to render a hardcoded catalogue, which meant the API was
 * never exercised by the UI. This script creates the same demo content as real
 * records — merchants, published stores, products with stock and themes — so the
 * marketplace can be driven entirely by the API.
 *
 * Idempotent: re-running logs into existing merchants instead of failing.
 *
 * Usage:
 *   npm run dev -w services/api        # in one terminal
 *   npm run seed:demo                  # in another
 */

const BASE = process.env.API_URL ?? 'http://localhost:4000';
const PASSWORD = 'DemoMerchant123!';

const THEMES = {
  sage: {
    themeId: 'sage',
    colors: { background: '#f4f8f3', accent: '#1f5c45', card: '#dce9df', text: '#17211b' },
  },
  sunset: {
    themeId: 'sunset',
    colors: { background: '#fff7f2', accent: '#b85632', card: '#f1d0bd', text: '#2b1a12' },
  },
  ocean: {
    themeId: 'ocean',
    colors: { background: '#f2f8fb', accent: '#2a6077', card: '#d7e5ed', text: '#10222b' },
  },
};

const DEMO_STORES = [
  {
    name: 'Ayoub Fashion',
    industry: 'fashion',
    description: 'Modern essentials and timeless pieces, made for everyday life.',
    theme: 'sage',
    products: [
      { title: 'Essential Overshirt', price: 89, stock: 24 },
      { title: 'Daily Canvas Tote', price: 39, stock: 40 },
      { title: 'Relaxed Cotton Shirt', price: 59, stock: 18 },
    ],
  },
  {
    name: 'Noura Living',
    industry: 'home',
    description: 'Thoughtful homeware and warm details for spaces you love.',
    theme: 'ocean',
    products: [
      { title: 'Hand-thrown Ceramic Mug', price: 28, stock: 60 },
      { title: 'Linen Cushion Cover', price: 45, stock: 22 },
      { title: 'Oak Serving Board', price: 74, stock: 9 },
    ],
  },
  {
    name: 'Pixel House',
    industry: 'electronics',
    description: 'Smart accessories and tech essentials for your daily setup.',
    theme: 'sunset',
    products: [
      { title: 'Magnetic Desk Stand', price: 65, stock: 31 },
      { title: 'Travel Charging Kit', price: 119, stock: 12 },
      { title: 'Wireless Mini Keyboard', price: 149, stock: 7 },
    ],
  },
  {
    name: 'Zina Beauty',
    industry: 'beauty',
    description: 'Simple, effective beauty rituals with carefully chosen ingredients.',
    theme: 'sage',
    products: [
      { title: 'Daily Face Oil', price: 42, stock: 50 },
      { title: 'Hydrating Body Balm', price: 34, stock: 45 },
      { title: 'Botanical Cleanser', price: 26, stock: 70 },
    ],
  },
  {
    name: 'Crafted North',
    industry: 'handmade',
    description: 'Small-batch objects crafted by independent makers.',
    theme: 'sunset',
    products: [
      { title: 'Hand-carved Bowl', price: 58, stock: 15 },
      { title: 'Woven Market Basket', price: 66, stock: 11 },
      { title: 'Stoneware Vase', price: 52, stock: 8 },
    ],
  },
  {
    name: 'Fuel Kitchen',
    industry: 'food',
    description: 'Good food, local ingredients, and easy ways to eat well.',
    theme: 'ocean',
    products: [
      { title: 'Granola Breakfast Box', price: 24, stock: 80 },
      { title: 'Pantry Essentials', price: 49, stock: 35 },
      { title: 'Weekend Treat Box', price: 39, stock: 26 },
    ],
  },
];

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

function slugOf(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function merchantFor(store) {
  const email = `${slugOf(store.name)}@mountain.demo`;

  const registered = await api('POST', '/api/auth/register', {
    body: { email, password: PASSWORD, firstName: store.name.split(' ')[0], lastName: 'Demo' },
  });

  // Already seeded on a previous run: log in and reuse the existing tenant.
  if (registered.status === 409) {
    const login = await api('POST', '/api/auth/login', { body: { email, password: PASSWORD } });
    if (login.status !== 200) {
      throw new Error(`could not log in ${email}: ${login.json?.error ?? login.status}`);
    }
    const stores = await api('GET', '/api/stores', { token: login.json.accessToken });
    const existing = stores.json?.items?.[0];
    if (!existing) throw new Error(`${email} exists but has no store`);
    return { token: login.json.accessToken, storeId: existing.id, storeSlug: existing.slug, created: false };
  }

  if (registered.status !== 201) {
    throw new Error(`could not register ${email}: ${registered.json?.error ?? registered.status}`);
  }

  const tenant = await api('POST', '/api/tenants', {
    token: registered.json.accessToken,
    body: { name: store.name, storeName: store.name, industry: store.industry, currency: 'USD' },
  });
  if (tenant.status !== 201) {
    throw new Error(`could not create tenant for ${store.name}: ${tenant.status}`);
  }

  return {
    token: tenant.json.accessToken,
    storeId: tenant.json.store.id,
    storeSlug: tenant.json.store.slug,
    created: true,
  };
}

async function seedStore(store) {
  const merchant = await merchantFor(store);

  // Publish, apply the theme, and give the demo stores a tax/shipping setup so
  // checkout totals are realistic rather than zero.
  await api('PATCH', `/api/stores/${merchant.storeId}`, {
    token: merchant.token,
    body: {
      published: true,
      themeSettings: THEMES[store.theme] ?? THEMES.sage,
      taxRate: 0.1,
      shippingFlatRate: 5,
    },
  });

  if (!merchant.created) {
    // Products already exist on a re-run; nothing more to do.
    console.log(`= ${store.name} (already seeded)`);
    return;
  }

  for (const product of store.products) {
    const created = await api('POST', '/api/products', {
      token: merchant.token,
      body: { title: product.title, price: product.price, currency: 'USD', description: `${product.title} — quality you can feel.` },
    });
    if (created.status !== 201) {
      console.warn(`  ! product "${product.title}" failed: ${created.status}`);
      continue;
    }

    await api('PATCH', `/api/products/${created.json.id}`, {
      token: merchant.token,
      body: { status: 'ACTIVE' },
    });

    const variantId = created.json.variants[0].id;
    await api('PUT', `/api/inventory/${created.json.id}/${variantId}`, {
      token: merchant.token,
      body: { stock: product.stock },
    });
  }

  console.log(`+ ${store.name} — ${store.products.length} products, published`);
}

const health = await api('GET', '/health');
if (health.status !== 200) {
  console.error(`API is not reachable at ${BASE}. Start it with: npm run dev -w services/api`);
  process.exit(1);
}

console.log(`Seeding demo stores via ${BASE}\n`);
for (const store of DEMO_STORES) {
  await seedStore(store);
}

const marketplace = await api('GET', '/api/storefront/stores');
console.log(
  `\nDone. The marketplace now lists ${marketplace.json?.total ?? 0} published stores.`,
);
console.log(`Merchant password for every demo account: ${PASSWORD}`);
