'use client';

import { useMemo, useState } from 'react';
import type { StoreSummary } from '../lib/api';
import { CATEGORIES } from '../lib/money';

const TONES = ['', 'blue', 'pink', 'purple'] as const;

export function MarketplaceBrowser({ stores }: { stores: StoreSummary[] }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<'Trending' | 'New' | 'Rating'>('Trending');

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    const matches = stores
      .filter((store) => category === 'all' || (store.industry ?? '').toLowerCase() === category)
      .filter(
        (store) =>
          !normalized ||
          `${store.name} ${store.industry ?? ''} ${store.description ?? ''}`
            .toLowerCase()
            .includes(normalized),
      );

    // "New" simply shows the most recently created stores; the API returns them
    // newest-first, so the order is already correct.
    if (sort === 'Rating') {
      return [...matches].sort((a, b) => (b.productCount ?? 0) - (a.productCount ?? 0));
    }
    return matches;
  }, [stores, query, category, sort]);

  return (
    <>
      <section className="hero">
        <div className="eyebrow">The Mountain marketplace</div>
        <h1>Find something made for you.</h1>
        <p>
          Discover independent brands, local businesses, and products you will love. Shop directly
          from the people behind every store.
        </p>
        <form className="search" onSubmit={(event) => event.preventDefault()}>
          <input
            aria-label="Search stores, products, or categories"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search stores, products, or categories..."
          />
          <button className="button" type="submit">
            Search marketplace
          </button>
        </form>
      </section>

      <section className="section" id="categories">
        <div className="section-heading">
          <div>
            <h2>Explore categories</h2>
            <p>Find your next favorite thing.</p>
          </div>
        </div>
        <div className="categories">
          {CATEGORIES.map((item, index) => (
            <button
              className={`category ${category === item.value ? 'active' : ''}`}
              key={item.value}
              onClick={() => setCategory(item.value)}
            >
              <span className="category-icon">{['*', 'F', 'E', 'B', 'H', 'F', 'S', 'C'][index]}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="section" id="stores">
        <div className="section-heading">
          <div>
            <h2>{query || category !== 'all' ? 'Search results' : 'Stores to discover'}</h2>
            <p>{filtered.length} independent stores worth exploring.</p>
          </div>
          <div className="filters">
            {(['Trending', 'New', 'Rating'] as const).map((item) => (
              <button
                key={item}
                className={`filter ${sort === item ? 'active' : ''}`}
                onClick={() => setSort(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="store-grid">
          {filtered.length ? (
            filtered.map((store, index) => (
              <article className="store-card" key={store.slug}>
                <div className={`store-cover ${TONES[index % TONES.length]}`}>
                  <div className="store-logo">{store.name.charAt(0).toUpperCase()}</div>
                </div>
                <div className="store-body">
                  <div className="store-title">
                    <h3>{store.name}</h3>
                    <span className="verified">Verified</span>
                  </div>
                  <p>{store.description || 'A new independent store powered by Mountain.'}</p>
                  <div className="meta">
                    <span>
                      <strong>{store.productCount ?? 0}</strong> products
                    </span>
                    <span>{store.industry ?? 'general'}</span>
                  </div>
                  <div className="store-footer">
                    <span className="meta">mountain.tn/store/{store.slug}</span>
                    <a className="button secondary" href={`/store/${store.slug}`}>
                      Visit store
                    </a>
                  </div>
                </div>
              </article>
            ))
          ) : (
            <div className="empty">No stores match that search. Try another keyword or category.</div>
          )}
        </div>
      </section>
    </>
  );
}
