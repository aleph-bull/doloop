import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Fail rather than move to 5174 when 5173 is taken: the always-on local copy
    // (`pnpm local:start`) may hold it, and a dev portal elsewhere would still proxy to its
    // API on 8787, which holds the real data.
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
