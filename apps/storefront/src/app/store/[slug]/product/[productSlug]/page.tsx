import { notFound } from 'next/navigation';
import { AddToCart } from '../../../../../components/AddToCart';
import { getStore, getStoreProduct } from '../../../../../lib/api';
import { formatMoney } from '../../../../../lib/money';

export const dynamic = 'force-dynamic';

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string; productSlug: string }>;
}) {
  const { slug, productSlug } = await params;

  let store;
  let product;

  try {
    store = await getStore(slug);
    product = await getStoreProduct(slug, productSlug);
  } catch {
    notFound();
  }

  const accent = store.themeSettings?.colors?.accent ?? '#1f5c45';
  const card = store.themeSettings?.colors?.card ?? '#dce9df';
  const page = store.themeSettings?.colors?.background ?? '#f4f8f3';

  return (
    <main className="store-page" style={{ background: page }}>
      <header className="nav">
        <a className="brand" href="/">
          <img className="brand-logo" src="/mountain-logo-cropped.jpg" alt="Mountain" /> mountain
        </a>
        <div className="nav-actions">
          <a className="view-link" href={`/store/${slug}/cart`}>
            Cart
          </a>
          <a className="view-link" href={`/store/${slug}`}>
            Back to {store.name}
          </a>
        </div>
      </header>

      <section className="product-detail">
        <div className="product-detail-media" style={{ background: card, color: accent }}>
          {store.name.charAt(0).toUpperCase()}
        </div>
        <div className="product-detail-body">
          <div className="eyebrow" style={{ color: accent }}>
            {product.brand ?? store.name}
          </div>
          <h1>{product.title}</h1>
          <div className="product-detail-price" style={{ color: accent }}>
            {formatMoney(product.price)}
          </div>
          <p>{product.description || 'No description provided yet.'}</p>

          <dl className="product-facts">
            <div>
              <dt>SKU</dt>
              <dd>{product.sku}</dd>
            </div>
            {product.variants?.length ? (
              <div>
                <dt>Variants</dt>
                <dd>{product.variants.length}</dd>
              </div>
            ) : null}
          </dl>

          <AddToCart slug={slug} productId={product.id} withQuantity />
        </div>
      </section>
    </main>
  );
}
