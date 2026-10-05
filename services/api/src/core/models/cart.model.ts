import mongoose, { Schema, type Model } from 'mongoose';

export interface ICartItem {
  productId: string;
  variantId?: string;
  quantity: number;
}

export interface ICart {
  _id: string;
  id: string;
  tenantId: string;
  storeId?: string;
  sessionId?: string;
  customerId?: string;
  items: ICartItem[];
  couponCode?: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CartItemSchema = new Schema<ICartItem>(
  {
    productId: { type: String, required: true },
    variantId: { type: String },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const CartSchema = new Schema<ICart>(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, required: true, index: true },
    storeId: { type: String, index: true },
    sessionId: { type: String, index: true },
    customerId: { type: String, index: true },
    items: [CartItemSchema],
    couponCode: { type: String },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      index: { expires: 0 },
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

export const CartModel: Model<ICart> =
  mongoose.models.Cart || mongoose.model<ICart>('Cart', CartSchema);
