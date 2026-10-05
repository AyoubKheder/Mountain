'use client';

import { useState } from 'react';
import { useCart } from '../lib/useCart';

/**
 * Adds a product to the server-side cart. On failure the API's own message is
 * shown — importantly, a stock refusal explains how many units actually remain
 * rather than silently adding what it can.
 */
export function AddToCart({
  slug,
  productId,
  withQuantity = false,
  label = 'Add to cart',
}: {
  slug: string;
  productId: string;
  withQuantity?: boolean;
  label?: string;
}) {
  const { add, pending, error, itemCount } = useCart(slug);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  async function onClick() {
    setAdded(false);
    const ok = await add(productId, quantity);
    if (ok) {
      setAdded(true);
      setQuantity(1);
    }
  }

  return (
    <div className="add-to-cart">
      <div className="add-to-cart-controls">
        {withQuantity && (
          <label className="quantity-input">
            <span className="sr-only">Quantity</span>
            <input
              type="number"
              min={1}
              max={99}
              value={quantity}
              onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
            />
          </label>
        )}
        <button className="button" type="button" onClick={onClick} disabled={pending}>
          {pending ? 'Adding…' : label}
        </button>
      </div>

      {added && (
        <p className="cart-feedback">
          Added. <a href={`/store/${slug}/cart`}>View cart ({itemCount})</a>
        </p>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
