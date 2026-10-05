/**
 * @mountain/auth — JWT issuance/verification and RBAC permission logic.
 * Spec sections 4 (roles & permissions) and 23 (security).
 */

import { SignJWT, jwtVerify } from 'jose';

export interface AccessTokenClaims {
  sub: string;
  email: string;
  platformRole?: string;
  tenantId?: string;
  merchantRole?: string;
  permissions: string[];
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * `issueTokens` also reports the refresh token's identity, so the caller can
 * register it for rotation without decoding the token it just signed.
 */
export interface IssuedTokens extends TokenPair {
  refreshJti: string;
  refreshFamily: string;
  refreshExpiresAt: number;
}

export interface AuthKeys {
  accessSecret: string;
  refreshSecret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

const encoder = new TextEncoder();

function key(secret: string): Uint8Array {
  return encoder.encode(secret);
}

export async function issueTokens(
  claims: AccessTokenClaims,
  keys: AuthKeys,
  options: { refreshFamily?: string } = {},
): Promise<IssuedTokens> {
  const now = Math.floor(Date.now() / 1000);

  const accessToken = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setIssuer('mountain')
    .setExpirationTime(now + keys.accessTtlSeconds)
    .sign(key(keys.accessSecret));

  // `jti` makes each refresh token individually revocable; `fam` groups every
  // token descended from one login, so a detected replay can revoke the whole
  // lineage rather than just the stolen token.
  const refreshJti = crypto.randomUUID();
  const refreshFamily = options.refreshFamily ?? crypto.randomUUID();
  const refreshExpiresAt = (now + keys.refreshTtlSeconds) * 1000;

  const refreshToken = await new SignJWT({
    sub: claims.sub,
    typ: 'refresh',
    jti: refreshJti,
    fam: refreshFamily,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setIssuer('mountain')
    .setExpirationTime(now + keys.refreshTtlSeconds)
    .sign(key(keys.refreshSecret));

  return { accessToken, refreshToken, refreshJti, refreshFamily, refreshExpiresAt };
}

export async function verifyAccessToken(
  token: string,
  accessSecret: string,
): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, key(accessSecret), { issuer: 'mountain' });
  if (typeof payload.sub !== 'string') {
    throw new Error('Invalid token: missing subject');
  }
  return {
    sub: payload.sub,
    email: String(payload.email ?? ''),
    platformRole: payload.platformRole as string | undefined,
    tenantId: payload.tenantId as string | undefined,
    merchantRole: payload.merchantRole as string | undefined,
    permissions: Array.isArray(payload.permissions) ? (payload.permissions as string[]) : [],
  };
}

export interface RefreshTokenClaims {
  sub: string;
  /** Unique id of this refresh token — the revocable unit. */
  jti: string;
  /** Login lineage this token belongs to. */
  family: string;
  /** Epoch milliseconds at which the token expires. */
  expiresAt: number;
}

export async function verifyRefreshToken(
  token: string,
  refreshSecret: string,
): Promise<RefreshTokenClaims> {
  const { payload } = await jwtVerify(token, key(refreshSecret), { issuer: 'mountain' });
  if (
    payload.typ !== 'refresh' ||
    typeof payload.sub !== 'string' ||
    typeof payload.jti !== 'string' ||
    typeof payload.fam !== 'string'
  ) {
    throw new Error('Invalid refresh token');
  }
  return {
    sub: payload.sub,
    jti: payload.jti,
    family: payload.fam,
    expiresAt: typeof payload.exp === 'number' ? payload.exp * 1000 : Date.now(),
  };
}

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------

/**
 * Merchant roles always imply these extra permissions.
 *
 * `stores.read` is granted to every operational role (the dashboard needs store
 * metadata to render); only OWNER and MANAGER may mutate store settings.
 */
const ROLE_BASE_PERMISSIONS: Record<string, string[]> = {
  OWNER: ['*'],
  MANAGER: [
    'products.*',
    'orders.*',
    'customers.*',
    'inventory.*',
    'analytics.read',
    'stores.*',
  ],
  STAFF: ['products.read', 'orders.read', 'orders.update', 'inventory.read', 'stores.read'],
  ACCOUNTANT: ['orders.read', 'payments.read', 'analytics.read', 'stores.read'],
  MARKETING: ['discounts.*', 'products.read', 'analytics.read', 'customers.read', 'stores.read'],
  FULFILLMENT: ['orders.read', 'orders.update', 'inventory.*', 'stores.read'],
  CUSTOMER_SUPPORT: ['orders.read', 'customers.read', 'reviews.*', 'stores.read'],
};

export const PLATFORM_ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ['*'],
  ADMIN: ['platform.*', 'tenants.*', 'users.*', 'billing.*', 'security.*', 'analytics.*'],
  FINANCE_ADMIN: ['platform.finance', 'billing.*', 'analytics.*'],
  SUPPORT_ADMIN: ['platform.support', 'support.*', 'users.read', 'tenants.read'],
  SECURITY_ADMIN: ['platform.security', 'security.*', 'audit.*'],
  MARKETING_ADMIN: ['platform.marketing', 'marketing.*'],
  ANALYTICS_ADMIN: ['platform.analytics', 'analytics.*'],
};

export function permissionsForRole(role: string, explicit: string[] = []): string[] {
  const base = ROLE_BASE_PERMISSIONS[role] ?? PLATFORM_ROLE_PERMISSIONS[role] ?? [];
  return [...new Set([...base, ...explicit])];
}

/** `*` and `orders.*` style wildcards are honored. */
export function hasPermission(granted: string[], required: string): boolean {
  return granted.some((g) => {
    if (g === '*') return true;
    if (g === required) return true;
    if (g.endsWith('.*')) {
      const prefix = g.slice(0, -1); // keep trailing dot
      return required.startsWith(prefix);
    }
    return false;
  });
}

export function requirePermission(granted: string[], required: string): void {
  if (!hasPermission(granted, required)) {
    throw new ForbiddenError(`Missing permission: ${required}`);
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}
