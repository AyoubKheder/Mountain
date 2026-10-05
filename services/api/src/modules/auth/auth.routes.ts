import { Router } from 'express';
import { loadConfig } from '@mountain/config';
import { registerSchema, loginSchema, refreshSchema } from './auth.schemas.js';
import {
  registerUser,
  authenticateUser,
  createTokenPair,
  rotateRefreshToken,
  listTenantMemberships,
  users,
} from './auth.service.js';
import { ApiError } from '../../core/errors.js';
import { wrap } from '../../core/context.js';
import { authenticate } from '../../core/middleware/authenticate.js';

export const authModule = Router();

function keys() {
  return loadConfig().jwt;
}

function parse<T>(schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: { issues: unknown[] } } }, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success || result.data === undefined) {
    const issue = result.error?.issues?.[0];
    const message =
      issue && typeof issue === 'object' && 'message' in issue
        ? String((issue as { message: string }).message)
        : 'Invalid request';
    throw new ApiError(400, message);
  }
  return result.data;
}

authModule.post(
  '/register',
  wrap(async (req, res) => {
    const input = parse(registerSchema, req.body);
    const user = await registerUser(input);
    const pair = await createTokenPair(user, undefined, keys());
    res.status(201).json({
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
      ...pair,
    });
  }),
);

authModule.post(
  '/login',
  wrap(async (req, res) => {
    const input = parse(loginSchema, req.body);
    const user = await authenticateUser(input.email, input.password);
    const membership = listTenantMemberships().find((m) => m.userId === user.id);
    const pair = await createTokenPair(user, membership, keys());
    res.json({
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
      ...pair,
    });
  }),
);

authModule.post(
  '/refresh',
  wrap(async (req, res) => {
    const input = parse(refreshSchema, req.body);
    const pair = await rotateRefreshToken(input.refreshToken, keys());
    res.json(pair);
  }),
);

authModule.get(
  '/me',
  authenticate(keys().accessSecret),
  wrap(async (req, res) => {
    const user = users.get(req.auth!.userId);
    if (!user) {
      throw new ApiError(404, 'User not found');
    }
    res.json({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      platformRole: user.platformRole,
      tenantId: req.auth!.tenantId,
      merchantRole: req.auth!.merchantRole,
      permissions: req.auth!.permissions,
    });
  }),
);
