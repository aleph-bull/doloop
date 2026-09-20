const PORTAL_URL = import.meta.env.VITE_PORTAL_URL ?? 'http://localhost:5173';

export function Options() {
  return (
    <main style={{ padding: 32, maxWidth: 480 }}>
      <h1 style={{ fontSize: 'var(--text-xl)', margin: 0 }}>Doloop</h1>
      <p style={{ color: 'var(--fg-muted)' }}>
        All settings live in the portal. This page only links there.
      </p>
      <a href={`${PORTAL_URL}/settings`} target="_blank" rel="noreferrer">
        Open portal settings
      </a>
    </main>
  );
}
