import { Route, Routes } from 'react-router';
import { Glass } from '@doloop/ui';

function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <Glass className="p-8 max-w-md w-full">
        <h1 className="text-2xl font-semibold tracking-tight">Doloop</h1>
        <p className="mt-2 text-[var(--fg-muted)]">Phase 0 scaffold. The app arrives in Phase 3.</p>
      </Glass>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  );
}
