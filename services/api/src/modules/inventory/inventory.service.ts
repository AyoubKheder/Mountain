/**
 * Inventory service — the single source of truth for stock.
 *
 * Design (see docs/shopify-benchmark.md §5.1):
 *
 *   available = stock - reserved
 *
 * A checkout takes a *hold* (`reserved += qty`) guarded by an atomic
 * "is there enough available?" condition, so the check and the write are one
 * indivisible operation. Payment confirmation *commits* the hold
 * (`stock -= qty`, `reserved -= qty`); cancellation, failure or TTL expiry
 * *releases* it (`reserved -= qty`). Committing or releasing is keyed by order
 * id and therefore idempotent — a replayed webhook does nothing.
 *
 * A product with no inventory record cannot be sold: absence of stock data is
 * treated as zero, never as "unlimited".
 */

import { newId } from '@mountain/utils';
import { ApiError } from '../../core/errors.js';
import { isMongoConnected } from '../../core/db.js';
import { InventoryModel, InventoryReservationModel } from '../../core/models/index.js';
import type { IInventory, IInventoryReservation } from '../../core/models/inventory.model.js';

/**
 * Reads a positive duration from the environment, falling back to a default.
 * Configurable so short TTLs can be exercised in tests and long ones in staging
 * without editing code — a hold that never expires is a silent stock leak.
 */
function durationFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** How long a checkout may hold stock before it is released. Matched to card payments. */
export const DEFAULT_RESERVATION_TTL_MS = durationFromEnv('RESERVATION_TTL_MS', 15 * 60 * 1000);

export interface InventoryRecord {
  id: string;
  tenantId: string;
  productId: string;
  variantId: string;
  sku: string;
  storeId?: string;
  stock: number;
  reserved: number;
  lowStockThreshold: number;
  updatedAt: string;
}

export interface InventoryView extends InventoryRecord {
  available: number;
  lowStock: boolean;
}

export interface ReservationLine {
  productId: string;
  variantId: string;
  quantity: number;
}

export interface ReservationRecord {
  id: string;
  tenantId: string;
  lines: ReservationLine[];
  status: 'HELD' | 'COMMITTED' | 'RELEASED';
  expiresAt: string;
}

/** In-memory mirrors — consistent with the rest of the scaffold's storage pattern. */
export const inventory = new Map<string, InventoryRecord>();
export const reservations = new Map<string, ReservationRecord>();

export function inventoryId(tenantId: string, productId: string, variantId: string): string {
  return `${tenantId}:${productId}:${variantId}`;
}

export function availableOf(record: Pick<InventoryRecord, 'stock' | 'reserved'>): number {
  return record.stock - record.reserved;
}

export function viewOf(record: InventoryRecord): InventoryView {
  const available = availableOf(record);
  return {
    ...record,
    available,
    lowStock: available <= record.lowStockThreshold,
  };
}

function toRecord(doc: IInventory): InventoryRecord {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId,
    productId: doc.productId,
    variantId: doc.variantId,
    sku: doc.sku,
    storeId: doc.storeId,
    stock: doc.stock,
    reserved: doc.reserved,
    lowStockThreshold: doc.lowStockThreshold,
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toReservation(doc: IInventoryReservation): ReservationRecord {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId,
    lines: doc.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity })),
    status: doc.status,
    expiresAt: doc.expiresAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Seeding & reads
// ---------------------------------------------------------------------------

/**
 * Creates the inventory record for a variant. Called when a product is created,
 * so a variant's declared stock becomes a real, sellable quantity.
 */
export async function seedInventory(input: {
  tenantId: string;
  productId: string;
  variantId: string;
  sku: string;
  storeId?: string;
  stock?: number;
  lowStockThreshold?: number;
}): Promise<InventoryRecord> {
  const id = inventoryId(input.tenantId, input.productId, input.variantId);
  const record: InventoryRecord = {
    id,
    tenantId: input.tenantId,
    productId: input.productId,
    variantId: input.variantId,
    sku: input.sku,
    storeId: input.storeId,
    stock: Math.max(0, Math.trunc(input.stock ?? 0)),
    reserved: 0,
    lowStockThreshold: input.lowStockThreshold ?? 5,
    updatedAt: new Date().toISOString(),
  };
  inventory.set(id, record);

  if (isMongoConnected()) {
    try {
      await InventoryModel.updateOne(
        { _id: id },
        {
          $setOnInsert: {
            _id: id,
            tenantId: record.tenantId,
            productId: record.productId,
            variantId: record.variantId,
            sku: record.sku,
            storeId: record.storeId,
            lowStockThreshold: record.lowStockThreshold,
          },
          $set: { stock: record.stock },
        },
        { upsert: true },
      );
    } catch (err) {
      console.warn('[inventory] Mongo seed error:', (err as Error).message);
    }
  }

  return record;
}

export async function getInventory(
  tenantId: string,
  productId: string,
  variantId: string,
): Promise<InventoryRecord | undefined> {
  const id = inventoryId(tenantId, productId, variantId);

  if (isMongoConnected()) {
    const doc = await InventoryModel.findOne({ _id: id, tenantId });
    if (doc) {
      const record = toRecord(doc);
      inventory.set(id, record);
      return record;
    }
  }

  const cached = inventory.get(id);
  return cached && cached.tenantId === tenantId ? cached : undefined;
}

export async function listInventory(
  tenantId: string,
  query: { search?: string; lowStockOnly?: boolean; page: number; pageSize: number },
): Promise<{ items: InventoryView[]; total: number; page: number; pageSize: number }> {
  let all: InventoryRecord[];

  if (isMongoConnected()) {
    const docs = await InventoryModel.find({ tenantId });
    if (docs.length > 0) {
      all = docs.map(toRecord);
      for (const record of all) inventory.set(record.id, record);
    } else {
      all = [...inventory.values()].filter((r) => r.tenantId === tenantId);
    }
  } else {
    all = [...inventory.values()].filter((r) => r.tenantId === tenantId);
  }

  let items = all.map(viewOf);
  if (query.search) {
    const q = query.search.toLowerCase();
    items = items.filter((r) => r.sku.toLowerCase().includes(q) || r.productId.toLowerCase().includes(q));
  }
  if (query.lowStockOnly) {
    items = items.filter((r) => r.lowStock);
  }

  items.sort((a, b) => a.available - b.available || a.sku.localeCompare(b.sku));

  const start = (query.page - 1) * query.pageSize;
  return {
    items: items.slice(start, start + query.pageSize),
    total: items.length,
    page: query.page,
    pageSize: query.pageSize,
  };
}

// ---------------------------------------------------------------------------
// Merchant operations
// ---------------------------------------------------------------------------

/** Sets the absolute physical stock for a variant. */
export async function setStock(
  tenantId: string,
  productId: string,
  variantId: string,
  stock: number,
  lowStockThreshold?: number,
): Promise<InventoryRecord> {
  if (!Number.isInteger(stock) || stock < 0) {
    throw new ApiError(400, 'Stock must be a non-negative integer');
  }
  if (lowStockThreshold !== undefined && (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0)) {
    throw new ApiError(400, 'Low-stock threshold must be a non-negative integer');
  }

  const existing = await getInventory(tenantId, productId, variantId);
  if (!existing) {
    throw new ApiError(404, 'No inventory record for this product variant');
  }
  if (stock < existing.reserved) {
    throw new ApiError(
      409,
      `Cannot set stock to ${stock}: ${existing.reserved} unit(s) are held by pending orders`,
    );
  }

  const updated: InventoryRecord = {
    ...existing,
    stock,
    lowStockThreshold: lowStockThreshold ?? existing.lowStockThreshold,
    updatedAt: new Date().toISOString(),
  };

  await persistStock(updated, { stock });
  return updated;
}

/** Relative stock movement — restock, shrinkage, manual correction. */
export async function adjustStock(
  tenantId: string,
  productId: string,
  variantId: string,
  delta: number,
): Promise<InventoryRecord> {
  if (!Number.isInteger(delta) || delta === 0) {
    throw new ApiError(400, 'Delta must be a non-zero integer');
  }

  const existing = await getInventory(tenantId, productId, variantId);
  if (!existing) {
    throw new ApiError(404, 'No inventory record for this product variant');
  }

  const stock = existing.stock + delta;
  if (stock < existing.reserved) {
    throw new ApiError(
      409,
      `Adjustment would leave ${stock} unit(s) on hand, below the ${existing.reserved} held by pending orders`,
    );
  }

  const updated: InventoryRecord = { ...existing, stock, updatedAt: new Date().toISOString() };
  await persistStock(updated, { stock });
  return updated;
}

async function persistStock(record: InventoryRecord, patch: { stock: number }): Promise<void> {
  inventory.set(record.id, record);
  if (isMongoConnected()) {
    try {
      const set: Record<string, unknown> = { stock: patch.stock, lowStockThreshold: record.lowStockThreshold };
      if (record.storeId !== undefined) set.storeId = record.storeId;
      await InventoryModel.updateOne({ _id: record.id, tenantId: record.tenantId }, { $set: set });
    } catch (err) {
      console.warn('[inventory] Mongo stock update error:', (err as Error).message);
    }
  }
}

// ---------------------------------------------------------------------------
// Holds: the overselling guard
// ---------------------------------------------------------------------------

/** Thrown-out shape is an ApiError(409) listing every line that cannot be served. */
export interface Shortage {
  productId: string;
  variantId: string;
  sku: string;
  requested: number;
  available: number;
}

/**
 * Checks whether every line can be served, without taking a hold.
 * Used by the cart to validate a basket before checkout.
 */
export async function checkAvailability(
  tenantId: string,
  lines: ReservationLine[],
): Promise<{ ok: boolean; shortages: Shortage[] }> {
  const shortages: Shortage[] = [];

  for (const line of lines) {
    const record = await getInventory(tenantId, line.productId, line.variantId);
    const available = record ? availableOf(record) : 0;
    if (available < line.quantity) {
      shortages.push({
        productId: line.productId,
        variantId: line.variantId,
        sku: record?.sku ?? 'unknown',
        requested: line.quantity,
        available,
      });
    }
  }

  return { ok: shortages.length === 0, shortages };
}

/** Merges duplicate lines (same variant) so a hold is not taken twice. */
function normaliseLines(lines: ReservationLine[]): ReservationLine[] {
  const merged = new Map<string, ReservationLine>();
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new ApiError(400, `Invalid quantity for variant ${line.variantId}`);
    }
    const key = `${line.productId}:${line.variantId}`;
    const existing = merged.get(key);
    if (existing) existing.quantity += line.quantity;
    else merged.set(key, { ...line });
  }
  // Deterministic order: every competing checkout locks in the same sequence,
  // which is what stops multi-line reservations from deadlocking each other.
  return [...merged.values()].sort((a, b) => `${a.productId}:${a.variantId}`.localeCompare(`${b.productId}:${b.variantId}`));
}

/**
 * Takes an all-or-nothing hold on every line.
 *
 * Locks are acquired in a deterministic global order; if any line cannot be
 * served, the holds already taken are released before throwing, so a failed
 * checkout never leaves stock stranded.
 */
export async function reserveForOrder(input: {
  tenantId: string;
  orderId: string;
  lines: ReservationLine[];
  ttlMs?: number;
}): Promise<ReservationRecord> {
  const existing = reservations.get(input.orderId);
  if (existing) return existing;

  const lines = normaliseLines(input.lines);

  for (const line of lines) {
    const record = await getInventory(input.tenantId, line.productId, line.variantId);
    if (!record) {
      throw new ApiError(409, `Product is not stocked and cannot be sold: ${line.productId}`);
    }
    if (availableOf(record) < line.quantity) {
      throw new ApiError(
        409,
        `Insufficient stock for ${record.sku}: requested ${line.quantity}, available ${availableOf(record)}`,
      );
    }
  }

  const held: ReservationLine[] = [];
  try {
    for (const line of lines) {
      await applyHold(input.tenantId, line, +1);
      held.push(line);
    }
  } catch (err) {
    for (const line of held) {
      await applyHold(input.tenantId, line, -1).catch(() => undefined);
    }
    throw err;
  }

  const reservation: ReservationRecord = {
    id: input.orderId,
    tenantId: input.tenantId,
    lines,
    status: 'HELD',
    expiresAt: new Date(Date.now() + (input.ttlMs ?? DEFAULT_RESERVATION_TTL_MS)).toISOString(),
  };
  reservations.set(reservation.id, reservation);

  if (isMongoConnected()) {
    try {
      await InventoryReservationModel.updateOne(
        { _id: reservation.id },
        {
          $setOnInsert: {
            _id: reservation.id,
            tenantId: reservation.tenantId,
            lines: reservation.lines,
          },
          $set: { status: reservation.status, expiresAt: new Date(reservation.expiresAt) },
        },
        { upsert: true },
      );
    } catch (err) {
      console.warn('[inventory] Mongo reservation write error:', (err as Error).message);
    }
  }

  return reservation;
}

/** Moves a held quantity in or out of `reserved`, atomically when Mongo is authoritative. */
async function applyHold(tenantId: string, line: ReservationLine, direction: 1 | -1): Promise<void> {
  const id = inventoryId(tenantId, line.productId, line.variantId);
  const record = inventory.get(id);

  if (record) {
    record.reserved = Math.max(0, record.reserved + direction * line.quantity);
    record.updatedAt = new Date().toISOString();
  }

  if (isMongoConnected()) {
    // Guarded conditional update: the availability check and the increment are a
    // single atomic operation, so two concurrent checkouts cannot both pass.
    const filter =
      direction === 1
        ? {
            _id: id,
            tenantId,
            $expr: { $gte: [{ $subtract: ['$stock', '$reserved'] }, line.quantity] },
          }
        : { _id: id, tenantId };

    const result = await InventoryModel.findOneAndUpdate(
      filter,
      { $inc: { reserved: direction * line.quantity } },
      { new: true },
    );

    if (!result && direction === 1) {
      throw new ApiError(409, 'Stock was taken by a concurrent checkout — please retry');
    }
    if (result) inventory.set(id, toRecord(result));
  }
}

/**
 * Converts a hold into a real decrement. Idempotent: a second call for the same
 * order is a no-op, which is what makes payment webhooks safe to replay.
 */
export async function commitReservation(orderId: string): Promise<ReservationRecord | undefined> {
  const reservation = await getReservation(orderId);
  if (!reservation) return undefined;
  if (reservation.status !== 'HELD') return reservation;

  for (const line of reservation.lines) {
    const id = inventoryId(reservation.tenantId, line.productId, line.variantId);
    const record = inventory.get(id);
    if (record) {
      record.stock = Math.max(0, record.stock - line.quantity);
      record.reserved = Math.max(0, record.reserved - line.quantity);
      record.updatedAt = new Date().toISOString();
    }
    if (isMongoConnected()) {
      await InventoryModel.updateOne(
        { _id: id, tenantId: reservation.tenantId },
        { $inc: { stock: -line.quantity, reserved: -line.quantity } },
      ).catch((err) => console.warn('[inventory] Mongo commit error:', (err as Error).message));
    }
  }

  reservation.status = 'COMMITTED';
  await persistReservationStatus(reservation);
  return reservation;
}

/** Gives a hold back — order cancelled, payment failed, or TTL expired. Idempotent. */
export async function releaseReservation(orderId: string): Promise<ReservationRecord | undefined> {
  const reservation = await getReservation(orderId);
  if (!reservation) return undefined;
  if (reservation.status !== 'HELD') return reservation;

  for (const line of reservation.lines) {
    await applyHold(reservation.tenantId, line, -1).catch((err) =>
      console.warn('[inventory] release error:', (err as Error).message),
    );
  }

  reservation.status = 'RELEASED';
  await persistReservationStatus(reservation);
  return reservation;
}

export async function getReservation(orderId: string): Promise<ReservationRecord | undefined> {
  if (isMongoConnected()) {
    const doc = await InventoryReservationModel.findOne({ _id: orderId });
    if (doc) {
      const record = toReservation(doc);
      reservations.set(record.id, record);
      return record;
    }
  }
  return reservations.get(orderId);
}

async function persistReservationStatus(reservation: ReservationRecord): Promise<void> {
  reservations.set(reservation.id, reservation);
  if (isMongoConnected()) {
    try {
      await InventoryReservationModel.updateOne(
        { _id: reservation.id },
        { $set: { status: reservation.status } },
      );
    } catch (err) {
      console.warn('[inventory] Mongo reservation update error:', (err as Error).message);
    }
  }
}

/**
 * Returns the units held by every checkout whose payment window has elapsed.
 *
 * Without this the `reserved` counter only ever grows: each abandoned checkout
 * would permanently remove units from `available`, and enough of them would make
 * a product look sold out while the shelves are full.
 *
 * This is the stock half of the janitor. Closing the orders behind those holds
 * is a separate concern and lives in `reservation.sweeper.ts`; call
 * `sweepExpiredReservations()` when you want both.
 *
 * Releasing is idempotent (a reservation already COMMITTED or RELEASED is left
 * alone), so an overlapping or repeated call cannot double-release.
 */
export async function releaseExpiredReservations(now: Date = new Date()): Promise<ReservationRecord[]> {
  const candidates = new Map<string, ReservationRecord>(reservations);

  if (isMongoConnected()) {
    try {
      const docs = await InventoryReservationModel.find({
        status: 'HELD',
        expiresAt: { $lte: now },
      });
      for (const doc of docs) {
        const record = toReservation(doc);
        candidates.set(record.id, record);
      }
    } catch (err) {
      console.warn('[inventory] reservation sweep query error:', (err as Error).message);
    }
  }

  const expired: ReservationRecord[] = [];
  for (const reservation of candidates.values()) {
    if (reservation.status !== 'HELD') continue;
    if (new Date(reservation.expiresAt).getTime() > now.getTime()) continue;

    const released = await releaseReservation(reservation.id);
    if (released && released.status === 'RELEASED') expired.push(released);
  }

  return expired;
}

/** Test helper. */
export function resetInventoryStore(): void {
  inventory.clear();
  reservations.clear();
}
