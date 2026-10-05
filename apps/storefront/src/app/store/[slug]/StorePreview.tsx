'use client';

import { useEffect, useState } from 'react';

type Store = { name: string; category: string; description: string; rating: string; products: string[]; mark: string };
type Draft = { slug?: string; theme?: string; tools?: string[]; storeName?: string; category?: string; description?: string };

const themes: Record<string, { name: string; page: string; accent: string; card: string }> = {
  sage: { name: 'Sage', page: '#f4f8f3', accent: '#1f5c45', card: '#dce9df' },
  sunset: { name: 'Sunset', page: '#fff7f2', accent: '#b85632', card: '#f1d0bd' },
  ocean: { name: 'Ocean', page: '#f2f8fb', accent: '#2a6077', card: '#d7e5ed' },
};
const defaultTheme = { name: 'Sage', page: '#f4f8f3', accent: '#1f5c45', card: '#dce9df' };

export default function StorePreview({ slug, store }: { slug: string; store: Store }) {
  const [draft, setDraft] = useState<Draft>({});
  useEffect(() => {
    const saved = localStorage.getItem('mountain-store-draft');
    if (saved) {
      try { setDraft(JSON.parse(saved) as Draft); } catch { localStorage.removeItem('mountain-store-draft'); }
    }
  }, []);
  const isMatchingDraft = draft.slug === slug;
  const activeStore = isMatchingDraft && draft.storeName ? { ...store, name: draft.storeName, category: draft.category || store.category, description: draft.description || store.description } : store;
  const theme = isMatchingDraft ? themes[draft.theme || 'sage'] || defaultTheme : themes.sage || defaultTheme;
  const tools = isMatchingDraft ? draft.tools || [] : [];

  return (
    <main className="store-page" style={{ background: theme.page }}>
      <header className="nav">
        <a className="brand" href="/"><img className="brand-logo" src="/mountain-logo-cropped.jpg" alt="Mountain" /> mountain</a>
        <a className="view-link" href="/">Back to marketplace</a>
      </header>
      <section className="store-profile" style={{ background: theme.page }}>
        <div className="profile-mark" style={{ background: theme.accent }}>{activeStore.mark}</div>
        <div className="eyebrow" style={{ color: theme.accent }}>{activeStore.category} store</div>
        <h1>{activeStore.name}</h1>
        <p>{activeStore.description}</p>
        <div className="profile-meta"><strong style={{ color: theme.accent }}>★ {activeStore.rating}</strong><span>{activeStore.rating === 'New' ? 'New store' : 'Verified store'}</span><span>mountain.tn/store/{slug}</span></div>
        <button className="button secondary" style={{ color: theme.accent }}>Follow store</button>
      </section>
      <section className="section">
        <div className="section-heading"><div><h2>Featured products</h2><p>Shop directly from {activeStore.name}.</p></div></div>
        <div className="product-grid">{activeStore.products.map((product, index) => <article className="product-card" key={product}><div className={`product-image product-${index + 1}`} style={index === 0 ? { background: theme.card, color: theme.accent } : undefined}>{activeStore.mark}</div><div className="product-info"><h3>{product}</h3><span style={{ color: theme.accent }}>View product</span></div></article>)}</div>
      </section>
      {tools.length > 0 && <section className="store-tools"><strong>Store tools</strong>{tools.includes('catalogue') && <span>Catalogue</span>}{tools.includes('social') && <span>Social links</span>}{tools.includes('qr') && <span>QR sharing</span>}{tools.includes('domain') && <span>Custom domain</span>}</section>}
    </main>
  );
}
