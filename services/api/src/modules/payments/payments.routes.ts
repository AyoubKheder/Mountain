import { Router } from 'express';
import { z } from 'zod';
import { loadConfig } from '@mountain/config';
import { authenticate } from '../../core/middleware/authenticate.js';
import { resolveTenant } from '../../core/middleware/resolveTenant.js';
import { requirePermission } from '../../core/middleware/requirePermission.js';
import { ApiError } from '../../core/errors.js';
import { wrap } from '../../core/context.js';
import { createPayment, refundPayment, listPaymentsForOrder } from './payments.service.js';
import { handleStripeWebhook } from './stripe.webhook.js';
import { bootstrapPaymentProviders } from './providers/index.js';

export const paymentsModule = Router();

/**
 * Stripe webhooks are unauthenticated by nature (Stripe is the caller) and must
 * be mounted *before* the merchant auth middleware. Their authenticity comes from
 * the HMAC signature, not from a bearer token.
 */
paymentsModule.post(
  '/webhooks/stripe',
  wrap(async (req, res) => {
    const signature = req.headers['stripe-signature'];
    const result = await handleStripeWebhook(
      req.body as Buffer,
      typeof signature === 'string' ? signature : undefined,
    );
    res.json(result);
  }),
);

// Providers are registered from configuration, not hardcoded.
bootstrapPaymentProviders();

paymentsModule.use(authenticate(loadConfig().jwt.accessSecret), resolveTenant);

const createPaymentSchema = z.object({
  orderId: z.string().min(1),
  providerId: z.string().min(1).default('MOCK'),
  amount: z.number().nonnegative(),
  currency: z.string().length(3).default('USD'),
});

const refundSchema = z.object({
  amount: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
});

paymentsModule.get(
  '/providers',
  requirePermission('orders.read'),
  wrap(async (_req, res) => {
    res.json({ providers: bootstrapPaymentProviders() });
  }),
);

paymentsModule.post(
  '/',
  requirePermission('orders.update'),
  wrap(async (req, res) => {
    const parsed = createPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid payment payload');
    }
    const { orderId, providerId, amount, currency } = parsed.data;
    const payment = await createPayment({
      tenantId: req.tenant!.tenantId,
      orderId,
      providerId,
      amount: { amount, currency: currency.toUpperCase() },
    });
    res.status(201).json(payment);
  }),
);

paymentsModule.post(
  '/:id/refund',
  requirePermission('orders.refund'),
  wrap(async (req, res) => {
    const parsed = refundSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ApiError(400, 'Invalid refund payload');
    }
    const payment = await refundPayment({
      tenantId: req.tenant!.tenantId,
      paymentId: req.params.id!,
      amount:
        parsed.data.amount !== undefined && parsed.data.currency
          ? { amount: parsed.data.amount, currency: parsed.data.currency.toUpperCase() }
          : undefined,
    });
    res.json(payment);
  }),
);

paymentsModule.get(
  '/order/:orderId',
  requirePermission('orders.read'),
  wrap(async (req, res) => {
    res.json({
      items: await listPaymentsForOrder(req.tenant!.tenantId, req.params.orderId!),
    });
  }),
);
