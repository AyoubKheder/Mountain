import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken, UnauthorizedError } from '@mountain/auth';
import type { AuthContext } from '../context.js';

export function authenticate(accessSecret: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      next(new UnauthorizedError('Missing bearer token'));
      return;
    }
    const token = header.slice('Bearer '.length);

    verifyAccessToken(token, accessSecret)
      .then((claims) => {
        req.auth = {
          userId: claims.sub,
          email: claims.email,
          platformRole: claims.platformRole,
          tenantId: claims.tenantId,
          merchantRole: claims.merchantRole,
          permissions: claims.permissions,
        };
        next();
      })
      .catch(() => {
        next(new UnauthorizedError('Invalid or expired token'));
      });
  };
}
