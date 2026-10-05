const NAV = [
  'Home',
  'Orders',
  'Products',
  'Customers',
  'Analytics',
  'Discounts',
  'AI tools',
  'Settings',
];

export function Dashboard() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <aside style={{ width: 220, borderRight: '1px solid #e5e7eb', padding: 24 }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>🏔️ Mountain</h1>
        <nav>
          {NAV.map((item) => (
            <div key={item} style={{ padding: '8px 0', color: '#374151', cursor: 'pointer' }}>
              {item}
            </div>
          ))}
        </nav>
      </aside>
      <main style={{ flex: 1, padding: 32 }}>
        <h2>Merchant dashboard</h2>
        <p style={{ color: '#6b7280' }}>
          Scaffolded shell. Orders, products, analytics and AI tools will mount here as modules
          are implemented against <code>@mountain/api</code>.
        </p>
      </main>
    </div>
  );
}
