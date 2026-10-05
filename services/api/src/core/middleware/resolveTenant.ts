import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '@mountain/auth';

/**
 * Resolves the active tenant for the request.
 *
 * Spec rule (section 3): never query tenant-owned resources without resolving
 * and validating the current tenant ID. Platform admins may act on any tenant
 * via the `x-tenant-id` header; merchant tokens are pinned to their own tenant.
 */
export function resolveTenant(req: Request, _res: Response, next: NextFunction): void {
  try {
    if (!req.auth) {
      throw new UnauthorizedError();
    }

    const isPlatformAdmin = Boolean(req.auth.platformRole);
    const requestedTenant =
      (req.headers['x-tenant-id'] as string | undefined) ?? (req.params.tenantId as string | undefined);

    if (isPlatformAdmin && requestedTenant) {
      req.tenant = { tenantId: requestedTenant };
      next();
      return;
    }

    if (isPlatformAdmin) {
      // Platform admin without a tenant target — allowed for platform-wide routes.
      next();
      return;
    }

    if (req.auth.tenantId) {
      if (requestedTenant && requestedTenant !== req.auth.tenantId) {
        throw new ForbiddenError('Tenant mismatch');
      }
      req.tenant = { tenantId: req.auth.tenantId };
      next();
      return;
    }

    throw new ForbiddenError('No tenant context available');
  } catch (err) {
    next(err);
  }
}
