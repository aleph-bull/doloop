import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider, applyTheme } from '@komogon/ui';
import { DEFAULT_SETTINGS } from '@komogon/core';
import './index.css';
import { App } from './App';
import { AchievementToasts } from './components/AchievementUnlocked';
import { AuthProvider } from './lib/auth';
import { unlockAudio } from './lib/sounds';
import { restoreQueryCache } from './lib/persist';
import { migrateOldStorage } from './lib/rename-migration';

// Before anything reads a storage key: move Doloop- and KomodoIt-era keys to Komogon names.
migrateOldStorage();

// Apply the default theme before first paint; the shell re-applies from user settings.
applyTheme({
  mode: DEFAULT_SETTINGS.theme.mode,
  accent: DEFAULT_SETTINGS.theme.accent,
  reducedMotion: DEFAULT_SETTINGS.effects.reducedMotion,
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
      // Restored data is shown immediately and refetched underneath, so the app opens on
      // your last-known state instead of a spinner. `gcTime` has to outlive the persisted
      // cache, or a restored query would be collected before anything could read it.
      gcTime: 7 * 24 * 60 * 60 * 1000,
    },
  },
});

// Fill the cache from disk before the first paint. Best-effort: if IndexedDB is missing,
// blocked or slow, this resolves false and the app starts empty exactly as it used to.
await restoreQueryCache(queryClient);

// A browser keeps an AudioContext suspended until the page has been interacted with, and
// an alert fired by a timer is not an interaction. Arm it on the first click or keypress.
unlockAudio();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <App />
            <AchievementToasts />
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
