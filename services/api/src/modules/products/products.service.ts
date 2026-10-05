/**
 * Products service — persists to MongoDB with automatic in-memory fallback.
 * Every query filters by tenantId per the isolation rule in spec section 3.
 */

import { newId, slugify, generateSku, money } from '@mountain/utils';
import type { Product } from '@mountain/types';
import { isMongoConnected } from '../../core/db.js';
import { ProductModel, type IProduct } from '../../core/models/index.js';
import { seedInventory } from '../inventory/inventory.service.js';

export interface ProductVariantItem {
  id: string;
  sku: string;
  price: { amount: number; currency: string };
  compareAtPrice?: { amount: number; currency: string };
  options: Record<string, string>;
  stock?: number;
}

export interface ProductMediaItem {
  url: string;
  type: 'IMAGE' | 'VIDEO';
  alt?: string;
  position: number;
}

export interface ProductRecord {
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
  options?: Array<{ name: string; values: string[] }>;
  variants?: ProductVariantItem[];
  media?: ProductMediaItem[];
  seo?: { title?: string; description?: string; keywords?: string[] };
  createdAt: string;
  updatedAt: string;
}

export const products = new Map<string, ProductRecord>();

export interface CreateProductInput {
  tenantId: string;
  storeId?: string;
  title: string;
  description?: string;
  brand?: string;
  categoryIds?: string[];
  tags?: string[];
  price: number;
  currency: string;
  sku?: string;
  options?: Array<{ name: string; values: string[] }>;
  variants?: Array<{
    id?: string;
    sku: string;
    price: number;
    currency?: string;
    compareAtPrice?: number;
    options: Record<string, string>;
    stock?: number;
  }>;
  media?: ProductMediaItem[];
  seo?: { title?: string; description?: string; keywords?: string[] };
}

export async function createProduct(input: CreateProductInput): Promise<ProductRecord> {
  const currency = input.currency ?? 'USD';
  const sku = input.sku ?? generateSku();

  const formattedVariants: ProductVariantItem[] =
    input.variants?.map((v) => ({
      id: v.id ?? newId(),
      sku: v.sku,
      price: money(v.price, v.currency ?? currency),
      compareAtPrice: v.compareAtPrice !== undefined ? money(v.compareAtPrice, v.currency ?? currency) : undefined,
      options: v.options ?? {},
      stock: v.stock ?? 0,
    })) ?? [
      {
        id: newId(),
        sku,
        price: money(input.price, currency),
        options: {},
        // A new product starts at zero: stock is declared by the merchant,
        // never invented by the platform.
        stock: 0,
      },
    ];

  const product: ProductRecord = {
    id: newId(),
    tenantId: input.tenantId,
    storeId: input.storeId,
    title: input.title,
    slug: slugify(input.title),
    description: input.description ?? '',
    brand: input.brand,
    categoryIds: input.categoryIds ?? [],
    tags: input.tags ?? [],
    price: money(input.price, currency),
    sku,
    status: 'DRAFT',
    options: input.options ?? [],
    variants: formattedVariants,
    media: input.media ?? [],
    seo: input.seo,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  products.set(product.id, product);

  // Inventory is the source of truth for stock: every variant gets a record,
  // seeded with the quantity the merchant declared when creating the product.
  for (const variant of formattedVariants) {
    await seedInventory({
      tenantId: product.tenantId,
      productId: product.id,
      variantId: variant.id,
      sku: variant.sku,
      storeId: product.storeId,
      stock: variant.stock ?? 0,
    });
  }

  if (isMongoConnected()) {
    try {
      await ProductModel.create({
        _id: product.id,
        tenantId: product.tenantId,
        storeId: product.storeId,
        title: product.title,
        slug: product.slug,
        description: product.description,
        brand: product.brand,
        categoryIds: product.categoryIds,
        tags: product.tags,
        price: product.price,
        sku: product.sku,
        status: product.status,
        options: product.options,
        variants: product.variants,
        media: product.media,
        seo: product.seo,
      });
    } catch (err) {
      console.warn('[products] MongoDB create error:', (err as Error).message);
    }
  }

  return product;
}

export async function listProducts(
  tenantId: string,
  query: { page: number; pageSize: number; status?: string; search?: string; storeId?: string },
): Promise<{ items: ProductRecord[]; total: number; page: number; pageSize: number }> {
  if (isMongoConnected()) {
    const filter: Record<string, unknown> = { tenantId };
    if (query.status) filter.status = query.status;
    if (query.storeId) filter.storeId = query.storeId;
    if (query.search) {
      filter.$or = [
        { title: { $regex: query.search, $options: 'i' } },
        { sku: { $regex: query.search, $options: 'i' } },
        { brand: { $regex: query.search, $options: 'i' } },
      ];
    }
    const [docs, total] = await Promise.all([
      ProductModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize),
      ProductModel.countDocuments(filter),
    ]);

    if (docs.length > 0 || total > 0) {
      const items: ProductRecord[] = docs.map(toProductRecord);
      return { items, total, page: query.page, pageSize: query.pageSize };
    }
  }

  const all = [...products.values()].filter((p) => p.tenantId === tenantId);
  const filtered = all.filter((p) => {
    if (query.status && p.status !== query.status) return false;
    if (query.storeId && p.storeId && p.storeId !== query.storeId) return false;
    if (query.search) {
      const q = query.search.toLowerCase();
      if (!p.title.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

  const start = (query.page - 1) * query.pageSize;
  return {
    items: filtered.slice(start, start + query.pageSize),
    total: filtered.length,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getProduct(tenantId: string, productId: string): Promise<ProductRecord | undefined> {
  if (isMongoConnected()) {
    const doc = await ProductModel.findOne({ _id: productId, tenantId });
    if (doc) {
      return toProductRecord(doc);
    }
  }
  const product = products.get(productId);
  return product && product.tenantId === tenantId ? product : undefined;
}

export async function updateProduct(
  tenantId: string,
  productId: string,
  patch: Partial<CreateProductInput> & { status?: Product['status'] },
): Promise<ProductRecord | undefined> {
  const existing = await getProduct(tenantId, productId);
  if (!existing) return undefined;

  const currency = patch.currency ?? existing.price.currency;
  const formattedVariants: ProductVariantItem[] =
    patch.variants !== undefined
      ? patch.variants.map((v) => ({
          id: v.id ?? newId(),
          sku: v.sku ?? generateSku(patch.title ?? existing.title),
          price: money(v.price, v.currency ?? currency),
          compareAtPrice: v.compareAtPrice !== undefined ? money(v.compareAtPrice, v.currency ?? currency) : undefined,
          options: v.options ?? {},
          stock: v.stock ?? 0,
        }))
      : (existing.variants ?? []);

  const updated: ProductRecord = {
    ...existing,
    ...(patch.title !== undefined && { title: patch.title }),
    ...(patch.description !== undefined && { description: patch.description }),
    ...(patch.brand !== undefined && { brand: patch.brand }),
    ...(patch.categoryIds !== undefined && { categoryIds: patch.categoryIds }),
    ...(patch.tags !== undefined && { tags: patch.tags }),
    ...(patch.sku !== undefined && { sku: patch.sku }),
    ...(patch.media !== undefined && { media: patch.media }),
    ...(patch.options !== undefined && { options: patch.options }),
    ...(patch.status !== undefined && { status: patch.status }),
    price: patch.price !== undefined ? money(patch.price, currency) : existing.price,
    slug: patch.title ? slugify(patch.title) : existing.slug,
    variants: formattedVariants,
    updatedAt: new Date().toISOString(),
  };

  products.set(productId, updated);

  if (isMongoConnected()) {
    try {
      await ProductModel.findOneAndUpdate({ _id: productId, tenantId }, updated);
    } catch (err) {
      console.warn('[products] MongoDB update error:', (err as Error).message);
    }
  }

  return updated;
}

export async function archiveProduct(tenantId: string, productId: string): Promise<boolean> {
  const existing = await getProduct(tenantId, productId);
  if (!existing) return false;

  const updated: ProductRecord = {
    ...existing,
    status: 'ARCHIVED',
    updatedAt: new Date().toISOString(),
  };
  products.set(productId, updated);

  if (isMongoConnected()) {
    try {
      await ProductModel.findOneAndUpdate({ _id: productId, tenantId }, { status: 'ARCHIVED' });
    } catch (err) {
      console.warn('[products] MongoDB archive error:', (err as Error).message);
    }
  }

  return true;
}

/** Maps a Mongoose product document onto the API record shape. */
export function toProductRecord(doc: IProduct): ProductRecord {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId,
    storeId: doc.storeId,
    title: doc.title,
    slug: doc.slug,
    description: doc.description,
    brand: doc.brand,
    categoryIds: doc.categoryIds,
    tags: doc.tags,
    price: doc.price,
    sku: doc.sku,
    status: doc.status,
    options: doc.options,
    variants: doc.variants as ProductVariantItem[],
    media: doc.media,
    seo: doc.seo,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * Single source of truth for "may this product appear on this storefront?".
 *
 * Applied identically to the MongoDB and in-memory paths so their semantics can
 * never drift apart — that drift is what leaked one tenant's catalogue onto
 * another tenant's store.
 *
 * A product is public for a store when it:
 *  - belongs to the tenant that owns the store (mandatory — spec section 3), and
 *  - is ACTIVE, and
 *  - is either unbound (`storeId` unset) or explicitly bound to that very store.
 */
export function isProductVisibleForStore(
  product: Pick<ProductRecord, 'tenantId' | 'storeId' | 'status'>,
  tenantId: string,
  storeId?: string,
): boolean {
  if (product.tenantId !== tenantId) return false;
  if (product.status !== 'ACTIVE') return false;
  if (storeId && product.storeId && product.storeId !== storeId) return false;
  return true;
}

/**
 * Public catalog lookup for storefronts (no merchant JWT required).
 *
 * Tenant-scoped by construction: the caller must supply the owning tenant, and
 * the optional `storeId` only narrows the result further.
 */
export async function listStorefrontProducts(
  tenantId: string,
  storeId?: string,
): Promise<ProductRecord[]> {
  if (isMongoConnected()) {
    const docs = await ProductModel.find({ tenantId, status: 'ACTIVE' }).sort({ createdAt: -1 });

    if (docs.length > 0) {
      return docs
        .map(toProductRecord)
        .filter((product) => isProductVisibleForStore(product, tenantId, storeId));
    }
  }

  return [...products.values()].filter((product) =>
    isProductVisibleForStore(product, tenantId, storeId),
  );
}
