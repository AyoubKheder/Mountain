import type { NextFunction, Request, Response } from 'express';

export interface AuthContext {
  userId: string;
  email: string;
  platformRole?: string;
  tenantId?: string;
  merchantRole?: string;
  permissions: string[];
}

export interface TenantContext {
  tenantId: string;
  storeId?: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
    tenant?: TenantContext;
  }
}

export type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

/** Wrap async route handlers so rejections reach the error middleware. */
export function wrap(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}
