import mongoose, { Schema, type Model } from 'mongoose';
import type { PlanId } from '@mountain/types';

export interface ITenant {
  _id: string;
  name: string;
  ownerId: string;
  plan: PlanId;
  status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  createdAt: Date;
  updatedAt: Date;
}

const TenantSchema = new Schema<ITenant>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    ownerId: { type: String, required: true, index: true },
    plan: {
      type: String,
      enum: ['FREE', 'STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE'],
      default: 'FREE',
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'SUSPENDED', 'CANCELLED'],
      default: 'ACTIVE',
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

export const TenantModel: Model<ITenant> =
  mongoose.models.Tenant || mongoose.model<ITenant>('Tenant', TenantSchema);
