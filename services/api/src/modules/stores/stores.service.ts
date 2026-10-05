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

/**
 * Updates a store owned by `tenantId`.
 *
 * Returns `undefined` when the store does not exist **or belongs to another
 * tenant**, so callers surface a 404 and never let a merchant touch a foreign
 * store. The tenant is validated on both persistence paths (spec section 3).
 *
 * `patch` is rebuilt as a whitelist: unknown keys (including `tenantId`) are
 * dropped, and `slug` is not updatable here so store URLs stay stable.
 */
export async function updateStore(
  tenantId: string,
  storeId: string,
  patch: Partial<StoreRecord>,
): Promise<StoreRecord | undefined> {
  const narrow = (patchValue: Partial<StoreRecord>): Partial<StoreRecord> => {
    const allowed: Partial<StoreRecord> = {};
    if (patchValue.name !== undefined) allowed.name = patchValue.name;
    if (patchValue.industry !== undefined) allowed.industry = patchValue.industry;
    if (patchValue.description !== undefined) allowed.description = patchValue.description;
    if (patchValue.defaultCurrency !== undefined) allowed.defaultCurrency = patchValue.defaultCurrency;
    if (patchValue.defaultLocale !== undefined) allowed.defaultLocale = patchValue.defaultLocale;
    if (patchValue.published !== undefined) allowed.published = patchValue.published;
    if (patchValue.themeSettings !== undefined) allowed.themeSettings = patchValue.themeSettings;
    if (patchValue.customDomains !== undefined) allowed.customDomains = patchValue.customDomains;
    return allowed;
  };

  const clean = narrow(patch);

  if (isMongoConnected()) {
    const existing = await StoreModel.findOne({ _id: storeId, tenantId });
    if (!existing) return undefined;

    const updated = await StoreModel.findOneAndUpdate(
      { _id: storeId, tenantId },
      { $set: clean },
      { new: true },
    );
    if (!updated) return undefined;

    return {
      id: updated._id.toString(),
      tenantId: updated.tenantId,
      name: updated.name,
      slug: updated.slug,
      industry: updated.industry,
      description: updated.description,
      defaultCurrency: updated.defaultCurrency,
      defaultLocale: updated.defaultLocale,
      published: updated.published,
      customDomains: updated.customDomains,
      themeSettings: updated.themeSettings,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  const existing = stores.get(storeId);
  if (!existing || existing.tenantId !== tenantId) return undefined;

  const updated: StoreRecord = { ...existing, ...clean };
  stores.set(storeId, updated);
  return updated;
}
