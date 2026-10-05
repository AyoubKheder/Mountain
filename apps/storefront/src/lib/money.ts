import type { Money } from './api';

const DECIMALS: Record<string, number> = {
  USD: 2, EUR: 2, GBP: 2, MAD: 2, CAD: 2, JPY: 0, KRW: 0,
};

export function formatMoney(money?: Money | null): string {
  if (!money) return '—';
  const decimals = DECIMALS[money.currency] ?? 2;
  const symbol = money.currency === 'USD' ? '$' : '';
  const amount = money.amount.toFixed(decimals);
  return symbol ? `${symbol}${amount}` : `${amount} ${money.currency}`;
}

/** Categories the marketplace offers, matched against a store's `industry`. */
export const CATEGORIES = [
  { label: 'All', value: 'all' },
  { label: 'Fashion', value: 'fashion' },
  { label: 'Electronics', value: 'electronics' },
  { label: 'Beauty', value: 'beauty' },
  { label: 'Home', value: 'home' },
  { label: 'Food', value: 'food' },
  { label: 'Sports', value: 'sports' },
  { label: 'Handmade', value: 'handmade' },
] as const;
