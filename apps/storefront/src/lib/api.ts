/**
 * Client for the Mountain API.
 *
 * Server components run inside the Next process, so they need an absolute URL
 * (`API_URL`). Client components must use a relative path so the request goes to
 * the browser's own origin and is proxied by the rewrite in next.config.mjs —
 * calling `localhost:4000` from the browser would break in any environment where
 * the API is not on the user's machine.
 */

const SERVER_BASE = process.env.API_URL ?? 'http://localhost:4000';

export interface Money {
  amount: number;
  currency: string;
}

export interface StoreSummary {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  industry?: string;
  description?: string;
  defaultCurrency: string;
  defaultLocale: string;
  themeSettings?: ThemeSettings;
  productCount?: number;
}

export interface ThemeSettings {
  themeId?: string;
  colors?: { background?: string; accent?: string; card?: string; text?: string };
  navigation?: { label: string; url: string }[];
}

export interface Product {
  id: string;
  title: string;
  slug: string;
  description: string;
  brand?: string;
  price: Money;
  sku: string;
  media?: { url: string; type: string; alt?: string; position: number }[];
  variants?: { id: string; sku: string; price: Money; stock?: number; options: Record<string, string> }[];
}

export interface CartLine {
  id: string;
  productId: string;
  variantId: string;
  sku: string;
  title: string;
  slug: string;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
}

export interface Cart {
  id: string;
  storeId?: string;
  customerId?: string;
  lines: CartLine[];
  itemCount: number;
  totals: { subtotal: Money; tax: Money; shipping: Money; total: Money };
  available: boolean;
  shortages: { sku: string; requested: number; available: number }[];
}

export interface PlacedOrder {
  orderNumber: string;
  orderId: string;
  status: string;
  paymentStatus: string;
  totals: { subtotal: Money; tax: Money; shipping: Money; total: Money };
  customerEmail: string;
  customerId?: string;
  payment: { status: string; provider: string; clientSecret: string | null } | null;
  replayed: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function url(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (typeof window !== 'undefined') return `/api${normalized}`;
  return `${SERVER_BASE}/api${normalized}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url(path), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
    // Catalogue data must never be served stale from the router cache.
    cache: 'no-store',
  });

  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    const message =
      (json as { error?: string } | null)?.error ?? `Request failed (${response.status})`;
    throw new ApiError(response.status, message);
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// Public storefront endpoints
// ---------------------------------------------------------------------------

export function listStores(): Promise<{ items: StoreSummary[]; total: number }> {
  return request('/storefront/stores');
}

export function getStore(slug: string): Promise<StoreSummary & { published: boolean }> {
  return request(`/storefront/stores/${encodeURIComponent(slug)}`);
}

export function listStoreProducts(slug: string): Promise<{ items: Product[]; total: number }> {
  return request(`/storefront/stores/${encodeURIComponent(slug)}/products`);
}

export function getStoreProduct(slug: string, productSlug: string): Promise<Product> {
  return request(
    `/storefront/stores/${encodeURIComponent(slug)}/products/${encodeURIComponent(productSlug)}`,
  );
}

export function createCart(slug: string): Promise<Cart> {
  return request(`/storefront/stores/${encodeURIComponent(slug)}/carts`, {
    method: 'POST',
    body: JSON.stringify({ sessionId: sessionId() }),
  });
}

export function getCart(slug: string, cartId: string): Promise<Cart> {
  return request(`/storefront/stores/${encodeURIComponent(slug)}/carts/${cartId}`);
}

export function addLine(slug: string, cartId: string, productId: string, quantity: number): Promise<Cart> {
  return request(`/storefront/stores/${encodeURIComponent(slug)}/carts/${cartId}/lines`, {
    method: 'POST',
    body: JSON.stringify({ productId, quantity }),
  });
}

export function updateLine(
  slug: string,
  cartId: string,
  lineId: string,
  quantity: number,
): Promise<Cart> {
  return request(
    `/storefront/stores/${encodeURIComponent(slug)}/carts/${cartId}/lines/${encodeURIComponent(lineId)}`,
    { method: 'PATCH', body: JSON.stringify({ quantity }) },
  );
}

export function removeLine(slug: string, cartId: string, lineId: string): Promise<Cart> {
  return request(
    `/storefront/stores/${encodeURIComponent(slug)}/carts/${cartId}/lines/${encodeURIComponent(lineId)}`,
    { method: 'DELETE' },
  );
}

export interface CheckoutInput {
  customerEmail: string;
  customerName?: string;
  shippingAddress: {
    line1: string;
    line2?: string;
    city: string;
    region?: string;
    postalCode: string;
    country: string;
    phone?: string;
  };
  paymentProvider?: 'MOCK' | 'CASH_ON_DELIVERY';
}

/**
 * Places the order. The `Idempotency-Key` makes a double submit safe: the server
 * replays the first result instead of charging twice.
 */
export function checkout(slug: string, cartId: string, input: CheckoutInput): Promise<PlacedOrder> {
  return request(`/storefront/stores/${encodeURIComponent(slug)}/checkout`, {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey(cartId) },
    body: JSON.stringify({ ...input, cartId }),
  });
}

// ---------------------------------------------------------------------------
// Merchant onboarding
// ---------------------------------------------------------------------------

export interface RegisteredMerchant {
  accessToken: string;
  refreshToken: string;
  tenantId: string;
  storeSlug: string;
}

/**
 * Opens a real store: registers the merchant, provisions the tenant (which
 * creates the store), then publishes it so it appears in the marketplace.
 */
export async function openStore(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  storeName: string;
  category: string;
  description?: string;
  marketplace: boolean;
  theme: string;
}): Promise<RegisteredMerchant> {
  const registered = await request<{ accessToken: string; refreshToken: string }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
    }),
  });

  const tenant = await request<{
    tenant: { id: string };
    store: { id: string; slug: string };
    accessToken?: string;
    refreshToken?: string;
  }>('/tenants', {
    method: 'POST',
    headers: { authorization: `Bearer ${registered.accessToken}` },
    body: JSON.stringify({
      name: input.storeName,
      storeName: input.storeName,
      industry: input.category,
      currency: 'USD',
    }),
  });

  // The tenant response carries a token scoped to the new tenant.
  const token = tenant.accessToken ?? registered.accessToken;

  const THEME_COLORS: Record<string, Record<string, string>> = {
    sage: { background: '#f4f8f3', accent: '#1f5c45', card: '#dce9df', text: '#17211b' },
    sunset: { background: '#fff7f2', accent: '#b85632', card: '#f1d0bd', text: '#2b1a12' },
    ocean: { background: '#f2f8fb', accent: '#2a6077', card: '#d7e5ed', text: '#10222b' },
  };

  await request(`/stores/${tenant.store.id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      description: input.description,
      published: input.marketplace,
      themeSettings: {
        themeId: input.theme,
        colors: THEME_COLORS[input.theme] ?? THEME_COLORS.sage,
      },
    }),
  });

  return {
    accessToken: tenant.accessToken ?? registered.accessToken,
    refreshToken: tenant.refreshToken ?? registered.refreshToken,
    tenantId: tenant.tenant.id,
    storeSlug: tenant.store.slug,
  };
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** Random, stable per browser — used to attribute an anonymous cart. */
export function sessionId(): string {
  if (typeof window === 'undefined') return 'server';
  const KEY = 'mountain-session';
  let existing = window.localStorage.getItem(KEY);
  if (!existing) {
    existing = `sess_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    window.localStorage.setItem(KEY, existing);
  }
  return existing;
}

function idempotencyKey(cartId: string): string {
  return `cart_${cartId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function cartIdKey(slug: string): string {
  return `mountain-cart-${slug}`;
}
