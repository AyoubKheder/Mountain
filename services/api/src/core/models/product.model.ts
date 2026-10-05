import mongoose, { Schema, type Model } from 'mongoose';
import type { Product } from '@mountain/types';

export interface IProductVariant {
  id: string;
  sku: string;
  price: { amount: number; currency: string };
  compareAtPrice?: { amount: number; currency: string };
  options: Record<string, string>;
  stock?: number;
}

export interface IProduct {
  _id: string;
  id: string;
  tenantId: string;
  storeId?: string;
  title: string;
  slug: string;
  description: string;
  brand?: string;
  categoryIds: string[];
  tags: string[];
  price: { amount: number; currency: string };
  sku: string;
  status: Product['status'];
  media: Array<{
    url: string;
    type: 'IMAGE' | 'VIDEO';
    alt?: string;
    position: number;
  }>;
  options: Array<{
    name: string;
    values: string[];
  }>;
  variants: IProductVariant[];
  seo?: {
    title?: string;
    description?: string;
    keywords?: string[];
  };
  createdAt: Date;
  updatedAt: Date;
}

const ProductVariantSchema = new Schema<IProductVariant>(
  {
    id: { type: String, required: true },
    sku: { type: String, required: true },
    price: {
      amount: { type: Number, required: true },
      currency: { type: String, required: true, uppercase: true },
    },
    compareAtPrice: {
      amount: { type: Number },
      currency: { type: String, uppercase: true },
    },
    options: { type: Map, of: String, default: {} },
    stock: { type: Number, default: 0 },
  },
  { _id: false },
);

const ProductSchema = new Schema<IProduct>(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, required: true, index: true },
    storeId: { type: String, index: true },
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true, index: true },
    description: { type: String, default: '' },
    brand: { type: String, trim: true },
    categoryIds: { type: [String], default: [] },
    tags: { type: [String], default: [] },
    price: {
      amount: { type: Number, required: true },
      currency: { type: String, required: true, uppercase: true },
    },
    sku: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'],
      default: 'DRAFT',
      index: true,
    },
    media: [
      {
        url: { type: String, required: true },
        type: { type: String, enum: ['IMAGE', 'VIDEO'], default: 'IMAGE' },
        alt: { type: String, default: '' },
        position: { type: Number, default: 0 },
      },
    ],
    options: [
      {
        name: { type: String, required: true },
        values: { type: [String], default: [] },
      },
    ],
    variants: [ProductVariantSchema],
    seo: {
      title: { type: String },
      description: { type: String },
      keywords: { type: [String], default: [] },
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

ProductSchema.index({ tenantId: 1, storeId: 1, status: 1 });
ProductSchema.index({ tenantId: 1, slug: 1 });
ProductSchema.index({ title: 'text', description: 'text', brand: 'text', tags: 'text' });

export const ProductModel: Model<IProduct> =
  mongoose.models.Product || mongoose.model<IProduct>('Product', ProductSchema);
