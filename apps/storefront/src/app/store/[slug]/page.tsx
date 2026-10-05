import { notFound } from 'next/navigation';
import { AddToCart } from '../../../components/AddToCart';
import { getStore, listStoreProducts, type Product } from '../../../lib/api';
import { formatMoney } from '../../../lib/money';

export const dynamic = 'force-dynamic';

const FALLBACK_THEME = {
  name: 'Sage',
  page: '#f4f8f3',
  accent: '#1f5c45',
  card: '#dce9df',
};

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let store;
  let products: Product[] = [];

  try {
    store = await getStore(slug);
    products = (await listStoreProducts(slug)).items;
  } catch {
    notFound();
  }

  const colors = store.themeSettings?.colors;
  const theme = {
    name: store.themeSettings?.themeId ?? FALLBACK_THEME.name,
    page: colors?.background ?? FALLBACK_THEME.page,
    accent: colors?.accent ?? FALLBACK_THEME.accent,
    card: colors?.card ?? FALLBACK_THEME.card,
  };

  return (
    <main className="store-page" style={{ background: theme.page }}>
      <header className="nav">
        <a className="brand" href="/">
          <img className="brand-logo" src="/mountain-logo-cropped.jpg" alt="Mountain" /> mountain
        </a>
        <div className="nav-actions">
          <a className="view-link" href={`/store/${slug}/cart`}>
            Cart
          </a>
          <a className="view-link" href="/">
            Back to marketplace
          </a>
        </div>
      </header>

      <section className="store-profile" style={{ background: theme.page }}>
        <div className="profile-mark" style={{ background: theme.accent }}>
          {store.name.charAt(0).toUpperCase()}
        </div>
        <div className="eyebrow" style={{ color: theme.accent }}>
          {store.industry ?? 'independent'} store
        </div>
        <h1>{store.name}</h1>
        <p>{store.description || 'A new independent store powered by Mountain.'}</p>
        <div className="profile-meta">
          <strong style={{ color: theme.accent }}>{products.length} products</strong>
          <span>Verified store</span>
          <span>mountain.tn/store/{slug}</span>
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <div>
            <h2>Featured products</h2>
            <p>Shop directly from {store.name}.</p>
          </div>
        </div>

        {products.length ? (
          <div className="product-grid">
            {products.map((product, index) => (
              <article className="product-card" key={product.id}>
                <div
                  className={`product-image product-${(index % 3) + 1}`}
                  style={{ background: theme.card, color: theme.accent }}
                >
                  {store.name.charAt(0).toUpperCase()}
                </div>
                <div className="product-info">
                  <h3>
                    <a href={`/store/${slug}/product/${product.slug}`}>{product.title}</a>
                  </h3>
                  <div className="product-price" style={{ color: theme.accent }}>
                    {formatMoney(product.price)}
                  </div>
                  <AddToCart slug={slug} productId={product.id} />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty">
            This store has not published any products yet. Once the merchant activates a product,
            it appears here.
          </div>
        )}
      </section>
    </main>
  );
}
