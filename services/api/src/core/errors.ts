import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '@mountain/auth';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ForbiddenError || err instanceof UnauthorizedError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error('[mountain-api] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
