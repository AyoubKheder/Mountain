import { listStores, type StoreSummary } from '../lib/api';
import { MarketplaceBrowser } from '../components/MarketplaceBrowser';

// Stores change as merchants publish, so this page must never be statically
// cached at build time.
export const dynamic = 'force-dynamic';

export default async function MarketplacePage() {
  let stores: StoreSummary[] = [];
  let error: string | null = null;

  try {
    stores = (await listStores()).items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'The API is unreachable';
  }

  return (
    <div className="page">
      <header className="nav">
        <a className="brand" href="/">
          <img className="brand-logo" src="/mountain-logo-cropped.jpg" alt="Mountain" /> mountain
        </a>
        <nav className="nav-links">
          <a href="#stores">Discover</a>
          <a href="#categories">Categories</a>
          <a href="#about">How it works</a>
        </nav>
        <div className="nav-actions">
          <button className="text-button">Log in</button>
          <a className="button" href="/open-store">
            Open a store
          </a>
        </div>
      </header>

      <main>
        {error ? (
          <section className="section">
            <div className="empty">
              <h2>The storefront could not reach the API</h2>
              <p>{error}</p>
              <p>
                Start it with <code>npm run dev -w services/api</code>, then load the demo content
                with <code>npm run seed:demo</code>.
              </p>
            </div>
          </section>
        ) : (
          <MarketplaceBrowser stores={stores} />
        )}
      </main>

      <footer className="footer" id="about">
        <div className="footer-inner">
          <div>
            <div className="brand">
              <img className="brand-logo" src="/mountain-logo-cropped.jpg" alt="Mountain" /> mountain
            </div>
            <p>Independent commerce, connected.</p>
          </div>
          <div>
            Are you a merchant?{' '}
            <a href="/open-store">
              <strong>Build your store on Mountain.</strong>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
