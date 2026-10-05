'use client';

/**
 * Cart state for one storefront.
 *
 * The cart lives on the server (that is the whole point: it survives reloads and
 * is recoverable). This hook only remembers *which* cart this browser owns — a
 * cart id in localStorage — and mirrors the server's view in React state, so the
 * server always remains the source of truth for prices, totals and stock.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  type Cart,
  addLine,
  cartIdKey,
  createCart,
  getCart,
  removeLine,
  updateLine,
} from './api';

type Attempt = { ok: true } | { ok: false; status: number };

export function useCart(slug: string) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remember = useCallback(
    (id: string) => window.localStorage.setItem(cartIdKey(slug), id),
    [slug],
  );

  const forget = useCallback(() => window.localStorage.removeItem(cartIdKey(slug)), [slug]);

  // Load the existing cart on mount. A cart that no longer exists server-side
  // (consumed by an order, or expired) is simply forgotten.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const id = window.localStorage.getItem(cartIdKey(slug));
      if (!id) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const existing = await getCart(slug, id);
        if (!cancelled) setCart(existing);
      } catch {
        forget();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [slug, forget]);

  /**
   * Runs a cart mutation, mirroring the result into state. The HTTP status is
   * returned so callers can distinguish "this cart is gone" (404) from "this
   * quantity is not available" (409) — the two need very different reactions.
   */
  const attempt = useCallback(async (action: () => Promise<Cart>): Promise<Attempt> => {
    setPending(true);
    setError(null);
    try {
      setCart(await action());
      return { ok: true };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      return { ok: false, status: err instanceof ApiError ? err.status : 0 };
    } finally {
      setPending(false);
    }
  }, []);

  /** Creates the cart on first use, so a shopper never sees an empty shell. */
  const ensureCart = useCallback(async (): Promise<string | null> => {
    if (cart) return cart.id;
    const id = window.localStorage.getItem(cartIdKey(slug));
    if (id) return id;

    try {
      const created = await createCart(slug);
      remember(created.id);
      setCart(created);
      return created.id;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start a cart');
      return null;
    }
  }, [cart, slug, remember]);

  const add = useCallback(
    async (productId: string, quantity = 1) => {
      const id = await ensureCart();
      if (!id) return false;

      const first = await attempt(() => addLine(slug, id, productId, quantity));
      if (first.ok) return true;

      // Only a vanished cart earns a retry. A stock refusal (409) must leave the
      // shopper's existing basket untouched.
      if (first.status !== 404) return false;

      forget();
      setCart(null);
      try {
        const fresh = await createCart(slug);
        remember(fresh.id);
        setCart(fresh);
        return (await attempt(() => addLine(slug, fresh.id, productId, quantity))).ok;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not add this item');
        return false;
      }
    },
    [ensureCart, attempt, slug, forget, remember],
  );

  const setQuantity = useCallback(
    async (lineId: string, quantity: number) => {
      if (!cart) return false;
      return (await attempt(() => updateLine(slug, cart.id, lineId, quantity))).ok;
    },
    [cart, attempt, slug],
  );

  const remove = useCallback(
    async (lineId: string) => {
      if (!cart) return false;
      return (await attempt(() => removeLine(slug, cart.id, lineId))).ok;
    },
    [cart, attempt, slug],
  );

  const clearLocal = useCallback(() => {
    forget();
    setCart(null);
  }, [forget]);

  return {
    cart,
    loading,
    pending,
    error,
    setError,
    itemCount: cart?.itemCount ?? 0,
    add,
    setQuantity,
    remove,
    clearLocal,
  };
}
