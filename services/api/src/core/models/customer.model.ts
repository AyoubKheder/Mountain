import mongoose, { Schema, type Model } from 'mongoose';

export interface ICustomerAddress {
  label?: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: string;
  phone?: string;
  isDefault?: boolean;
}

export interface ICustomer {
  _id: string;
  tenantId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  note?: string;
  tags: string[];
  acceptsMarketing: boolean;
  addresses: ICustomerAddress[];
  ordersCount: number;
  totalSpent: { amount: number; currency: string };
  lastOrderAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerAddressSchema = new Schema<ICustomerAddress>(
  {
    label: { type: String },
    line1: { type: String, required: true },
    line2: { type: String },
    city: { type: String, required: true },
    region: { type: String },
    postalCode: { type: String, required: true },
    country: { type: String, required: true },
    phone: { type: String },
    isDefault: { type: Boolean, default: false },
  },
  { _id: false },
);

const CustomerSchema = new Schema<ICustomer>(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    phone: { type: String },
    note: { type: String },
    tags: { type: [String], default: [] },
    acceptsMarketing: { type: Boolean, default: false },
    addresses: [CustomerAddressSchema],
    ordersCount: { type: Number, default: 0, min: 0 },
    totalSpent: {
      amount: { type: Number, default: 0 },
      currency: { type: String, uppercase: true, default: 'USD' },
    },
    lastOrderAt: { type: Date },
  },
  { timestamps: true, _id: false },
);

// A customer is unique per tenant: the same shopper can buy from two merchants.
CustomerSchema.index({ tenantId: 1, email: 1 }, { unique: true });
CustomerSchema.index({ tenantId: 1, createdAt: -1 });

export const CustomerModel: Model<ICustomer> =
  mongoose.models.Customer || mongoose.model<ICustomer>('Customer', CustomerSchema);
