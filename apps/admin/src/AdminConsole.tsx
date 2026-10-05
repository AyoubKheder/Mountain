const SECTIONS = [
  'Platform overview',
  'Merchants & stores',
  'Subscriptions & payments',
  'Support tickets',
  'Security & audit logs',
  'Infrastructure health',
  'AI usage & costs',
];

export function AdminConsole() {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
      <h1 style={{ fontSize: 22 }}>🏔️ Mountain Admin</h1>
      <p style={{ color: '#6b7280' }}>
        Platform command center scaffold. Sections below map to spec section 34 and will be built
        against the <code>/api/admin</code> endpoints.
      </p>
      <ul style={{ lineHeight: 2, color: '#374151' }}>
        {SECTIONS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </div>
  );
}
