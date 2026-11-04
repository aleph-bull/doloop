import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config.ts';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    rollupOptions: {
      // The page blocked sites go to is named only in web_accessible_resources, which copies
      // it untouched; as an input its script is built too (it was a blank page until 2026-11-04).
      input: { blocked: 'src/blocked/index.html' },
    },
  },
  server: {
    port: 5174,
    cors: { origin: [/chrome-extension:\/\//] },
  },
});
