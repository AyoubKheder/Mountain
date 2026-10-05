import mongoose, { Schema, type Model } from 'mongoose';
import type { OrderStatus } from '@mountain/types';

export interface IOrderItem {
  productId: string;
  variantId?: string;
  title: string;
  sku: string;
  quantity: number;
  unitPrice: { amount: number; currency: string };
}

export interface IOrder {
  _id: string;
  id: string;
  tenantId: string;
  storeId?: string;
  number: string;
  customerId?: string;
  customerEmail?: string;
  status: OrderStatus;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED' | 'FAILED';
  fulfillmentStatus: 'UNFULFILLED' | 'PARTIAL' | 'FULFILLED';
  items: IOrderItem[];
  totals: {
    subtotal: { amount: number; currency: string };
    discount?: { amount: number; currency: string };
    tax: { amount: number; currency: string };
    shipping: { amount: number; currency: string };
    total: { amount: number; currency: string };
  };
  shippingAddress?: {
    line1: string;
    line2?: string;
    city: string;
    region?: string;
    postalCode: string;
    country: string;
    phone?: string;
  };
  paymentId?: string;
  timeline: Array<{ status: OrderStatus; at: string; note?: string }>;
  createdAt: Date;
  updatedAt: Date;
}

const OrderItemSchema = new Schema<IOrderItem>(
  {
    productId: { type: String, required: true },
    variantId: { type: String },
    title: { type: String, required: true },
    sku: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: {
      amount: { type: Number, required: true },
      currency: { type: String, required: true, uppercase: true },
    },
  },
  { _id: false },
);

const OrderSchema = new Schema<IOrder>(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, required: true, index: true },
    storeId: { type: String, index: true },
    number: { type: String, required: true, unique: true, index: true },
    customerId: { type: String },
    customerEmail: { type: String, lowercase: true, trim: true },
    status: {
      type: String,
      enum: [
        'PENDING',
        'CONFIRMED',
        'PROCESSING',
        'SHIPPED',
        'DELIVERED',
        'CANCELLED',
        'REFUNDED',
        'RETURNED',
        'FAILED',
      ],
      default: 'PENDING',
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ['PENDING', 'PAID', 'REFUNDED', 'FAILED'],
      default: 'PENDING',
    },
    fulfillmentStatus: {
      type: String,
      enum: ['UNFULFILLED', 'PARTIAL', 'FULFILLED'],
      default: 'UNFULFILLED',
    },
    items: [OrderItemSchema],
    totals: {
      subtotal: {
        amount: { type: Number, required: true },
        currency: { type: String, required: true, uppercase: true },
      },
      discount: {
        amount: { type: Number },
        currency: { type: String, uppercase: true },
      },
      tax: {
        amount: { type: Number, required: true, default: 0 },
        currency: { type: String, required: true, uppercase: true },
      },
      shipping: {
        amount: { type: Number, required: true, default: 0 },
        currency: { type: String, required: true, uppercase: true },
      },
      total: {
        amount: { type: Number, required: true },
        currency: { type: String, required: true, uppercase: true },
      },
    },
    shippingAddress: {
      line1: { type: String },
      line2: { type: String },
      city: { type: String },
      region: { type: String },
      postalCode: { type: String },
      country: { type: String },
      phone: { type: String },
    },
    paymentId: { type: String },
    timeline: [
      {
        status: { type: String, required: true },
        at: { type: String, required: true },
        note: { type: String },
      },
    ],
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

OrderSchema.index({ tenantId: 1, storeId: 1, createdAt: -1 });

export const OrderModel: Model<IOrder> =
  mongoose.models.Order || mongoose.model<IOrder>('Order', OrderSchema);
