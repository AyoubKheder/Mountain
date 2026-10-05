'use client';

import { FormEvent, useState } from 'react';
import { ApiError, openStore } from '../../lib/api';

const storeCategories = ['Fashion', 'Electronics', 'Beauty', 'Home', 'Food', 'Sports', 'Handmade', 'Digital products'];
const themes = [
  { id: 'sage', name: 'Sage', description: 'Calme et naturel', color: '#dce9df', accent: '#1f5c45' },
  { id: 'sunset', name: 'Sunset', description: 'Chaleureux et audacieux', color: '#f1d0bd', accent: '#b85632' },
  { id: 'ocean', name: 'Ocean', description: 'Moderne et lumineux', color: '#d7e5ed', accent: '#2a6077' },
];
const storeTools = [
  { id: 'catalogue', label: 'Catalogue produits', description: 'Ajouter vos produits et collections' },
  { id: 'social', label: 'Réseaux sociaux', description: 'Connecter Instagram, TikTok ou Facebook' },
  { id: 'qr', label: 'QR code du store', description: 'Partager votre boutique partout' },
  { id: 'domain', label: 'Domaine personnalisé', description: 'Connecter votre propre domaine plus tard' },
];

function createSlug(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

export default function OpenStorePage() {
  const [storeName, setStoreName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [marketplace, setMarketplace] = useState(true);
  const [theme, setTheme] = useState('sage');
  const [tools, setTools] = useState(['catalogue', 'social', 'qr']);
  const [createdSlug, setCreatedSlug] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  /**
   * Creates a real merchant: registers the account, provisions the tenant (which
   * creates the store), applies the chosen theme and publishes it if the merchant
   * opted into the marketplace. The store that appears afterwards is a real
   * record served by the API, not a browser draft.
   */
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const slug = createSlug(storeName);
    if (!slug) {
      setError('Enter a store name to continue.');
      return;
    }
    if (password.length < 10) {
      setError('Choose a password of at least 10 characters, with an uppercase letter, a lowercase letter and a digit.');
      return;
    }

    setError('');
    setSubmitting(true);

    try {
      const [firstName, ...rest] = storeName.trim().split(' ');
      const result = await openStore({
        email,
        password,
        firstName: firstName || 'Merchant',
        lastName: rest.join(' ') || 'Owner',
        storeName,
        category: category.toLowerCase().replace(/[^a-z]/g, '') || 'general',
        description: description || undefined,
        marketplace,
        theme,
      });
      setCreatedSlug(result.storeSlug);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('An account with this email already exists. Try another email address.');
      } else if (err instanceof ApiError && err.status === 400) {
        setError(err.message);
      } else {
        setError(
          err instanceof Error
            ? `${err.message} — is the API running? (npm run dev -w services/api)`
            : 'Could not create the store.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (createdSlug) {
    const selectedTheme = themes.find((item) => item.id === theme) ?? themes[0]!;
    const selectedTools = storeTools.filter((tool) => tools.includes(tool.id));

    return (
      <main className="onboarding-page">
        <a className="brand onboarding-brand" href="/"><img className="brand-logo" src="/mountain-logo-cropped.jpg" alt="Mountain" /> mountain</a>
        <section className="success-card">
          <div className="success-icon">✓</div>
          <div className="eyebrow">Your store is live</div>
          <h1>Welcome to Mountain, {storeName}.</h1>
          <p>
            Your store exists on the platform. Add products and configure delivery from your
            merchant dashboard — customers can already visit it.
          </p>
          <div className="store-url"><span>Public store URL</span><strong>mountain.tn/store/{createdSlug}</strong></div>
          <div className="setup-summary">
            <div className="setup-theme"><span className="theme-summary-swatch" style={{ background: selectedTheme.color }}><i style={{ background: selectedTheme.accent }} /></span><span><small>Selected theme</small><strong>{selectedTheme.name}</strong></span></div>
            <div className="setup-tools"><small>Enabled tools</small><div>{selectedTools.length ? selectedTools.map((tool) => <span className="tool-pill" key={tool.id}>{tool.label}</span>) : <span className="muted-pill">No tools selected</span>}</div></div>
          </div>
          <p className="form-note">
            {marketplace
              ? 'Your store is listed in the marketplace.'
              : 'Your store is unlisted — it will not appear in the marketplace.'}
          </p>
          <div className="onboarding-actions"><a className="button" href={`/store/${createdSlug}`}>Visit your store</a><a className="button secondary" href="/">Back to marketplace</a></div>
        </section>
      </main>
    );
  }

  return (
    <main className="onboarding-page">
      <a className="brand onboarding-brand" href="/"><img className="brand-logo" src="/mountain-logo-cropped.jpg" alt="Mountain" /> mountain</a>
      <section className="onboarding-shell">
        <div className="onboarding-intro"><div className="eyebrow">Start selling on Mountain</div><h1>Open your store in minutes.</h1><p>Tell us a little about your business. You can refine the design, add products and configure payments after this step.</p><div className="steps"><span className="step active">1 <b>Store details</b></span><span className="step">2 Customize</span><span className="step">3 Publish</span></div>
          {(() => {
            const previewTheme = themes.find((item) => item.id === theme) ?? themes[0]!;
            const previewName = storeName.trim() || 'Your store name';
            const previewSlug = createSlug(storeName) || 'your-store-name';
            return <aside className="live-preview" aria-label="Live store preview">
              <div className="preview-topline"><span>LIVE PREVIEW</span><span className="preview-dot" /></div>
              <div className="preview-window" style={{ background: previewTheme.color }}>
                <div className="preview-nav"><span className="preview-brand-mark">{previewName.charAt(0).toUpperCase()}</span><strong>{previewName}</strong><span className="preview-menu">☰</span></div>
                <div className="preview-hero"><small>{category || 'Your category'}</small><strong>{previewName}</strong><p>{description || 'Your store description will appear here.'}</p><span className="preview-shop-button" style={{ background: previewTheme.accent }}>Shop collection</span></div>
                <div className="preview-products"><span /><span /><span /></div>
              </div>
              <div className="preview-address">mountain.tn/store/<strong>{previewSlug}</strong></div>
            </aside>;
          })()}
        </div>
        <form className="store-form" onSubmit={submit}>
          <label>Store name<input required value={storeName} onChange={(event) => setStoreName(event.target.value)} placeholder="e.g. Ayoub Fashion" /></label>
          <label>Category<select required value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Choose a category</option>{storeCategories.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Short description<span className="label-hint">Optional</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What makes your store special?" rows={4} maxLength={160} /></label>
          <label>Contact email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
          <label>Password<span className="label-hint">At least 10 characters, mixed case and a digit</span><input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••••" /></label>
          <label className="checkbox-label"><input type="checkbox" checked={marketplace} onChange={(event) => setMarketplace(event.target.checked)} /><span><strong>Show my store in the Mountain marketplace</strong><small>Customers can discover your store. You can change this later.</small></span></label>
          <fieldset className="theme-fieldset"><legend>Choose a store theme</legend><div className="theme-grid">{themes.map((item) => <button className={`theme-card ${theme === item.id ? 'selected' : ''}`} key={item.id} type="button" onClick={() => setTheme(item.id)}><span className="theme-preview" style={{ background: item.color }}><span style={{ background: item.accent }} /></span><strong>{item.name}</strong><small>{item.description}</small></button>)}</div></fieldset>
          <fieldset className="tools-fieldset"><legend>Store tools</legend>{storeTools.map((tool) => <label className="tool-option" key={tool.id}><input type="checkbox" checked={tools.includes(tool.id)} onChange={(event) => setTools((current) => event.target.checked ? [...current, tool.id] : current.filter((id) => id !== tool.id))} /><span><strong>{tool.label}</strong><small>{tool.description}</small></span></label>)}</fieldset>
          {error && <p className="form-error">{error}</p>}
          <button className="button form-submit" type="submit" disabled={submitting}>
            {submitting ? 'Creating your store…' : 'Create my store'}
          </button>
          <p className="form-note">By continuing, you agree to Mountain&apos;s merchant terms.</p>
        </form>
      </section>
    </main>
  );
}
