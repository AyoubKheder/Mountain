import mongoose, { Schema, type Model } from 'mongoose';
import type { PaymentStatus } from '@mountain/types';

export interface IPayment {
  _id: string;
  id: string;
  tenantId: string;
  orderId: string;
  provider: string;
  providerRef?: string;
  /** Handed to the storefront so it can confirm the payment with the provider. */
  clientSecret?: string;
  status: PaymentStatus;
  amount: { amount: number; currency: string };
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, required: true, index: true },
    orderId: { type: String, required: true, index: true },
    provider: { type: String, required: true },
    providerRef: { type: String },
    clientSecret: { type: String },
    status: {
      type: String,
      enum: ['REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'CANCELLED'],
      default: 'PROCESSING',
      index: true,
    },
    amount: {
      amount: { type: Number, required: true },
      currency: { type: String, required: true, uppercase: true },
    },
  },
  {
    timestamps: true,
    _id: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

export const PaymentModel: Model<IPayment> =
  mongoose.models.Payment || mongoose.model<IPayment>('Payment', PaymentSchema);
