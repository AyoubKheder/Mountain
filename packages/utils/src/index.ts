/**
 * @mountain/utils — shared helpers used across services and apps.
 */

import type { Money } from '@mountain/types';

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

const CURRENCY_DECIMALS: Record<string, number> = {
  USD: 2, EUR: 2, GBP: 2, MAD: 2, CAD: 2,
  JPY: 0, KRW: 0,
};

export function decimalsFor(currency: string): number {
  return CURRENCY_DECIMALS[currency.toUpperCase()] ?? 2;
}

export function money(amount: number, currency: string): Money {
  const d = decimalsFor(currency);
  return { amount: Number(amount.toFixed(d)), currency: currency.toUpperCase() };
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function multiplyMoney(m: Money, factor: number): Money {
  return money(m.amount * factor, m.currency);
}

export function formatMoney(m: Money): string {
  return `${m.amount.toFixed(decimalsFor(m.currency))} ${m.currency}`;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

// ---------------------------------------------------------------------------
// Inventory math (spec section 9)
// ---------------------------------------------------------------------------

export function availableStock(inventory: { stock: number; reserved: number }): number {
  return inventory.stock - inventory.reserved;
}

export function isLowStock(inventory: { stock: number; reserved: number }, threshold = 5): boolean {
  return availableStock(inventory) <= threshold;
}

// ---------------------------------------------------------------------------
// Slugs, SKUs & ids
// ---------------------------------------------------------------------------

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function newId(): string {
  return globalThis.crypto.randomUUID();
}

export function generateSku(prefix = 'SKU'): string {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${rand}`;
}

export function orderNumber(): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `ORD-${stamp}-${rand}`;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface PageInfo {
  page: number;
  pageSize: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export function clampPageInfo(page?: number, pageSize?: number): PageInfo {
  const p = Math.max(1, Number(page ?? 1) || 1);
  const s = Math.min(100, Math.max(1, Number(pageSize ?? 20) || 20));
  return { page: p, pageSize: s };
}
