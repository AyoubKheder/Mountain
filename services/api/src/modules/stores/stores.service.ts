/**
 * Stores service — persists to MongoDB if available, with in-memory fallback.
 */

import { isMongoConnected } from '../../core/db.js';
import { StoreModel } from '../../core/models/index.js';

export interface StoreRecord {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  industry?: string;
  description?: string;
  defaultCurrency: string;
  defaultLocale: string;
  published: boolean;
  customDomains?: Array<{ hostname: string; verified: boolean; sslActive: boolean }>;
  themeSettings?: {
    themeId?: string;
    colors?: { background?: string; accent?: string; card?: string; text?: string };
    navigation?: Array<{ label: string; url: string }>;
  };
  createdAt: string;
}

export const stores = new Map<string, StoreRecord>();

export async function listStores(tenantId: string): Promise<StoreRecord[]> {
  if (isMongoConnected()) {
    const dbStores = await StoreModel.find({ tenantId });
    if (dbStores.length > 0) {
      return dbStores.map((s) => ({
        id: s._id.toString(),
        tenantId: s.tenantId,
        name: s.name,
        slug: s.slug,
        industry: s.industry,
        description: s.description,
        defaultCurrency: s.defaultCurrency,
        defaultLocale: s.defaultLocale,
        published: s.published,
        customDomains: s.customDomains,
        themeSettings: s.themeSettings,
        createdAt: s.createdAt.toISOString(),
      }));
    }
  }
  return [...stores.values()].filter((s) => s.tenantId === tenantId);
}

export async function getStoreBySlug(slug: string): Promise<StoreRecord | undefined> {
  const normalizedSlug = slug.toLowerCase().trim();
  if (isMongoConnected()) {
    const s = await StoreModel.findOne({ slug: normalizedSlug });
    if (s) {
      return {
        id: s._id.toString(),
        tenantId: s.tenantId,
        name: s.name,
        slug: s.slug,
        industry: s.industry,
        description: s.description,
        defaultCurrency: s.defaultCurrency,
        defaultLocale: s.defaultLocale,
        published: s.published,
        customDomains: s.customDomains,
        themeSettings: s.themeSettings,
        createdAt: s.createdAt.toISOString(),
      };
    }
  }
  return [...stores.values()].find((s) => s.slug.toLowerCase() === normalizedSlug);
}

export async function updateStore(
  tenantId: string,
  storeId: string,
  patch: Partial<StoreRecord>,
): Promise<StoreRecord | undefined> {
  const existing = stores.get(storeId);
  const updated: StoreRecord = {
    ...(existing ?? {
      id: storeId,
      tenantId,
      name: patch.name ?? 'Store',
      slug: patch.slug ?? 'store',
      defaultCurrency: 'USD',
      defaultLocale: 'en',
      published: false,
      createdAt: new Date().toISOString(),
    }),
    ...patch,
  };
  stores.set(storeId, updated);

  if (isMongoConnected()) {
    try {
      await StoreModel.findOneAndUpdate({ _id: storeId, tenantId }, patch, { upsert: true, new: true });
    } catch (err) {
      console.warn('[stores] Mongo update error:', (err as Error).message);
    }
  }

  return updated;
}
