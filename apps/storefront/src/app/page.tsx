'use client';

import { useEffect, useMemo, useState } from 'react';

type Store = {
  name: string;
  slug: string;
  category: string;
  description: string;
  rating: string;
  products: number;
  followers: string;
  mark: string;
  tone: string;
  featured: boolean;
};

const categories = [
  ['All', 'all'], ['Fashion', 'fashion'], ['Electronics', 'electronics'], ['Beauty', 'beauty'],
  ['Home', 'home'], ['Food', 'food'], ['Sports', 'sports'], ['Handmade', 'handmade'],
] as const;

const stores: Store[] = [
  { name: 'Ayoub Fashion', slug: 'ayoub-fashion', category: 'Fashion', description: 'Modern essentials and timeless pieces, made for everyday life.', rating: '4.9', products: 128, followers: '2.4k', mark: 'A', tone: '', featured: true },
  { name: 'Noura Living', slug: 'noura-living', category: 'Home', description: 'Thoughtful homeware and warm details for spaces you love.', rating: '4.8', products: 76, followers: '1.8k', mark: 'N', tone: 'blue', featured: true },
  { name: 'Pixel House', slug: 'pixel-house', category: 'Electronics', description: 'Smart accessories and tech essentials for your daily setup.', rating: '4.7', products: 94, followers: '3.1k', mark: 'P', tone: 'pink', featured: true },
  { name: 'Zina Beauty', slug: 'zina-beauty', category: 'Beauty', description: 'Simple, effective beauty rituals with carefully chosen ingredients.', rating: '4.9', products: 52, followers: '1.2k', mark: 'Z', tone: 'purple', featured: false },
  { name: 'Crafted North', slug: 'crafted-north', category: 'Handmade', description: 'Small-batch objects crafted by independent makers.', rating: '4.8', products: 41, followers: '890', mark: 'C', tone: '', featured: false },
  { name: 'Fuel Kitchen', slug: 'fuel-kitchen', category: 'Food', description: 'Good food, local ingredients, and easy ways to eat well.', rating: '4.6', products: 35, followers: '760', mark: 'F', tone: 'blue', featured: false },
];

export default function MarketplacePage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState('Trending');
  const [merchantStore, setMerchantStore] = useState<Store | null>(null);

  useEffect(() => {
    const savedStore = localStorage.getItem('mountain-store-draft');
    if (!savedStore) return;
    try {
      const draft = JSON.parse(savedStore) as { storeName?: string; slug?: string; category?: string; description?: string; marketplace?: boolean };
      if (draft.marketplace && draft.storeName && draft.slug && draft.category) {
        setMerchantStore({
          name: draft.storeName,
          slug: draft.slug,
          category: draft.category,
          description: draft.description || 'A new independent store powered by Mountain.',
          rating: 'New',
          products: 0,
          followers: '0',
          mark: draft.storeName.charAt(0).toUpperCase(),
          tone: '',
          featured: false,
        });
      }
    } catch {
      localStorage.removeItem('mountain-store-draft');
    }
  }, []);

  const filteredStores = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (merchantStore ? [merchantStore, ...stores] : stores)
      .filter((store) => category === 'all' || store.category.toLowerCase() === category)
      .filter((store) => !normalized || `${store.name} ${store.category} ${store.description}`.toLowerCase().includes(normalized))
      .sort((a, b) => sort === 'Rating' ? Number(b.rating) - Number(a.rating) : sort === 'New' ? Number(b.products) - Number(a.products) : Number(b.followers.replace('k', '')) - Number(a.followers.replace('k', '')));
  }, [category, merchantStore, query, sort]);

  return (
    <div className="page">
      <header className="nav">
        <a className="brand" href="/"><img className="brand-logo" src="/mountain-logo-cropped.jpg" alt="Mountain" /> mountain</a>
        <nav className="nav-links"><a href="#stores">Discover</a><a href="#categories">Categories</a><a href="#about">How it works</a></nav>
        <div className="nav-actions"><button className="text-button">Log in</button><a className="button" href="/open-store">Open a store</a></div>
      </header>

      <main>
        <section className="hero">
          <div className="eyebrow">The Mountain marketplace</div>
          <h1>Find something made for you.</h1>
          <p>Discover independent brands, local businesses, and products you will love. Shop directly from the people behind every store.</p>
          <form className="search" onSubmit={(event) => event.preventDefault()}>
            <input aria-label="Search stores, products, or categories" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search stores, products, or categories..." />
            <button className="button" type="submit">Search marketplace</button>
          </form>
        </section>

        <section className="section" id="categories">
          <div className="section-heading"><div><h2>Explore categories</h2><p>Find your next favorite thing.</p></div></div>
          <div className="categories">
            {categories.map(([label, value], index) => <button className={`category ${category === value ? 'active' : ''}`} key={value} onClick={() => setCategory(value)}><span className="category-icon">{['*', 'F', 'E', 'B', 'H', 'F', 'S', 'C'][index]}</span><span>{label}</span></button>)}
          </div>
        </section>

        <section className="section" id="stores">
          <div className="section-heading"><div><h2>{query || category !== 'all' ? 'Search results' : 'Stores to discover'}</h2><p>{filteredStores.length} independent stores worth exploring.</p></div><div className="filters">{['Trending', 'New', 'Rating'].map((item) => <button key={item} className={`filter ${sort === item ? 'active' : ''}`} onClick={() => setSort(item)}>{item}</button>)}</div></div>
          <div className="store-grid">
            {filteredStores.length ? filteredStores.map((store) => <article className="store-card" key={store.slug}>
              <div className={`store-cover ${store.tone}`}><div className="store-logo">{store.mark}</div></div>
              <div className="store-body"><div className="store-title"><h3>{store.name}</h3><span className="verified">{store.rating === 'New' ? 'New store' : 'Verified'}</span></div><p>{store.description}</p><div className="meta"><span><strong>{store.rating === 'New' ? 'New' : `★ ${store.rating}`}</strong>{store.rating === 'New' ? ' on Mountain' : ' rating'}</span><span>{store.products} products</span></div><div className="store-footer"><span className="meta">{store.followers} followers</span><a className="button secondary" href={`/store/${store.slug}`}>Visit store</a></div></div>
            </article>) : <div className="empty">No stores match that search. Try another keyword or category.</div>}
          </div>
        </section>
      </main>

      <footer className="footer" id="about"><div className="footer-inner"><div><div className="brand"><img className="brand-logo" src="/mountain-logo-cropped.jpg" alt="Mountain" /> mountain</div><p>Independent commerce, connected.</p></div><div>Are you a merchant? <a href="/open-store"><strong>Build your store on Mountain.</strong></a></div></div></footer>
    </div>
  );
}
