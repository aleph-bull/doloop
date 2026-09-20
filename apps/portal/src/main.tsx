import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { applyTheme } from '@doloop/ui';
import { DEFAULT_SETTINGS } from '@doloop/core';
import './index.css';
import { App } from './App';

applyTheme({
  mode: DEFAULT_SETTINGS.theme.mode,
  accent: DEFAULT_SETTINGS.theme.accent,
  reducedMotion: DEFAULT_SETTINGS.effects.reducedMotion,
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
