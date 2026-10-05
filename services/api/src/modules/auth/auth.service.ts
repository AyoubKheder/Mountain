/**
 * Auth service — registration, login and refresh flows.
 * Passwords are hashed with bcrypt (spec names Argon2id as the target; swap
 * `hashPassword`/`verifyPassword` when migrating to the argon2 package).
 */

import bcrypt from 'bcryptjs';
import type {
  AccessTokenClaims,
  AuthKeys,
  TokenPair,
} from '@mountain/auth';
import { issueTokens, verifyRefreshToken, permissionsForRole } from '@mountain/auth';
import { newId } from '@mountain/utils';
import { ApiError } from '../../core/errors.js';

export interface UserRecord {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
  platformRole?: string;
  twoFactorEnabled: boolean;
  createdAt: string;
}

export interface TenantMembership {
  userId: string;
  tenantId: string;
  role: string;
  explicitPermissions: string[];
}

// In-memory stores — replaced by Mongo collections when persistence lands.
export const users = new Map<string, UserRecord>();
const usersByEmail = new Map<string, string>();
const memberships = new Map<string, TenantMembership>();

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plain, passwordHash);
}

import { isMongoConnected } from '../../core/db.js';
import { UserModel, TenantMembershipModel } from '../../core/models/index.js';

export async function registerUser(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}): Promise<UserRecord> {
  const email = input.email.toLowerCase();

  if (isMongoConnected()) {
    const existing = await UserModel.findOne({ email });
    if (existing) {
      throw new ApiError(409, 'An account with this email already exists');
    }
  } else if (usersByEmail.has(email)) {
    throw new ApiError(409, 'An account with this email already exists');
  }

  const user: UserRecord = {
    id: newId(),
    email,
    firstName: input.firstName,
    lastName: input.lastName,
    passwordHash: await hashPassword(input.password),
    twoFactorEnabled: false,
    createdAt: new Date().toISOString(),
  };

  if (isMongoConnected()) {
    try {
      await UserModel.create({
        _id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        passwordHash: user.passwordHash,
        platformRole: user.platformRole,
        twoFactorEnabled: user.twoFactorEnabled,
      });
    } catch {
      // ignore concurrent duplicate or continue
    }
  }

  users.set(user.id, user);
  usersByEmail.set(email, user.id);
  return user;
}

export async function authenticateUser(
  email: string,
  password: string,
): Promise<UserRecord> {
  const normalizedEmail = email.toLowerCase();
  let user: UserRecord | undefined;

  if (isMongoConnected()) {
    const dbUser = await UserModel.findOne({ email: normalizedEmail });
    if (dbUser) {
      user = {
        id: dbUser._id.toString(),
        email: dbUser.email,
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
        passwordHash: dbUser.passwordHash,
        platformRole: dbUser.platformRole ?? undefined,
        twoFactorEnabled: dbUser.twoFactorEnabled,
        createdAt: dbUser.createdAt.toISOString(),
      };
      users.set(user!.id, user!);
      usersByEmail.set(normalizedEmail, user!.id);
    }
  }

  if (!user) {
    const userId = usersByEmail.get(normalizedEmail);
    user = userId ? users.get(userId) : undefined;
  }

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new ApiError(401, 'Invalid email or password');
  }
  return user;
}

export function assignTenantMembership(membership: TenantMembership): void {
  memberships.set(`${membership.userId}:${membership.tenantId}`, membership);
  if (isMongoConnected()) {
    TenantMembershipModel.findOneAndUpdate(
      { userId: membership.userId, tenantId: membership.tenantId },
      {
        _id: `${membership.userId}:${membership.tenantId}`,
        userId: membership.userId,
        tenantId: membership.tenantId,
        role: membership.role,
        explicitPermissions: membership.explicitPermissions,
      },
      { upsert: true },
    ).catch((err) => console.error('[auth] failed to persist membership', err));
  }
}

export function getTenantMembership(userId: string, tenantId: string): TenantMembership | undefined {
  return memberships.get(`${userId}:${tenantId}`);
}

function claimsFor(user: UserRecord, membership?: TenantMembership): AccessTokenClaims {
  const role = membership?.role ?? 'STAFF';
  const merchantPerms = membership ? permissionsForRole(role, membership.explicitPermissions) : [];
  const platformPerms = user.platformRole ? permissionsForRole(user.platformRole) : [];
  const permissions = [...new Set([...merchantPerms, ...platformPerms])];

  return {
    sub: user.id,
    email: user.email,
    platformRole: user.platformRole,
    tenantId: membership?.tenantId,
    merchantRole: membership ? role : undefined,
    permissions,
  };
}

export async function createTokenPair(
  user: UserRecord,
  membership: TenantMembership | undefined,
  keys: AuthKeys,
): Promise<TokenPair> {
  return issueTokens(claimsFor(user, membership), keys);
}

export async function rotateRefreshToken(
  refreshToken: string,
  keys: AuthKeys,
): Promise<TokenPair> {
  const { sub } = await verifyRefreshToken(refreshToken, keys.refreshSecret);
  const user = users.get(sub);
  if (!user) {
    throw new ApiError(401, 'Unknown user for refresh token');
  }
  // Pick the user's first membership; multi-tenant users will choose actively.
  const membership = listTenantMemberships().find((m) => m.userId === sub);
  return issueTokens(claimsFor(user, membership), keys);
}

/** Test/admin helper. */
export function resetAuthStore(): void {
  users.clear();
  usersByEmail.clear();
  memberships.clear();
}

export function listTenantMemberships(): TenantMembership[] {
  return [...memberships.values()];
}
