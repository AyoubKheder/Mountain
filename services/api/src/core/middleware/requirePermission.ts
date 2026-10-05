import type { Request, Response, NextFunction } from 'express';
import { hasPermission, ForbiddenError } from '@mountain/auth';

export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new ForbiddenError('Not authenticated'));
      return;
    }
    if (!hasPermission(req.auth.permissions, permission)) {
      next(new ForbiddenError(`Missing permission: ${permission}`));
      return;
    }
    next();
  };
}
