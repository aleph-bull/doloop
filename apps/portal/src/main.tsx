import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider, applyTheme } from '@doloop/ui';
import { DEFAULT_SETTINGS } from '@doloop/core';
import './index.css';
import { App } from './App';
import { AuthProvider } from './lib/auth';

// Apply the default theme before first paint; the shell re-applies from user settings.
applyTheme({
  mode: DEFAULT_SETTINGS.theme.mode,
  accent: DEFAULT_SETTINGS.theme.accent,
  reducedMotion: DEFAULT_SETTINGS.effects.reducedMotion,
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
