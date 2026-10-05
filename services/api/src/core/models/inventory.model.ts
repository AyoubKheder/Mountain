import mongoose, { Schema, type Model } from 'mongoose';

/**
 * Inventory is the single source of truth for stock.
 *
 * `available = stock - reserved`. `reserved` is incremented when a checkout
 * holds units, and converted to a real decrement of `stock` when the payment
 * confirms. This two-counter model is what prevents overselling: the check and
 * the write are the same guarded operation, never a read followed by a blind
 * write.
 *
 * See docs/shopify-benchmark.md §5.1.
 */
export interface IInventory {
  _id: string;
  tenantId: string;
  productId: string;
  variantId: string;
  sku: string;
  storeId?: string;
  /** Physical units on hand. */
  stock: number;
  /** Units held by pending orders, not yet committed. */
  reserved: number;
  lowStockThreshold: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A hold taken by a checkout. Keyed by orderId so committing or releasing it is
 * naturally idempotent: a replayed webhook finds the record in a terminal state
 * and does nothing.
 */
export interface IInventoryReservation {
  _id: string;
  tenantId: string;
  lines: Array<{ productId: string; variantId: string; quantity: number }>;
  status: 'HELD' | 'COMMITTED' | 'RELEASED';
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const InventorySchema = new Schema<IInventory>(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, required: true, index: true },
    productId: { type: String, required: true, index: true },
    variantId: { type: String, required: true },
    sku: { type: String, required: true, index: true },
    storeId: { type: String, index: true },
    stock: { type: Number, required: true, default: 0, min: 0 },
    reserved: { type: Number, required: true, default: 0, min: 0 },
    lowStockThreshold: { type: Number, required: true, default: 5 },
  },
  { timestamps: true, _id: false },
);

InventorySchema.index({ tenantId: 1, productId: 1, variantId: 1 }, { unique: true });
InventorySchema.index({ tenantId: 1, sku: 1 });

const InventoryReservationSchema = new Schema<IInventoryReservation>(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, required: true, index: true },
    lines: [
      {
        productId: { type: String, required: true },
        variantId: { type: String, required: true },
        quantity: { type: Number, required: true, min: 1 },
      },
    ],
    status: { type: String, enum: ['HELD', 'COMMITTED', 'RELEASED'], default: 'HELD', index: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true, _id: false },
);

export const InventoryModel: Model<IInventory> =
  mongoose.models.Inventory || mongoose.model<IInventory>('Inventory', InventorySchema);

export const InventoryReservationModel: Model<IInventoryReservation> =
  mongoose.models.InventoryReservation ||
  mongoose.model<IInventoryReservation>('InventoryReservation', InventoryReservationSchema);
