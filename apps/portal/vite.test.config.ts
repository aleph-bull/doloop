import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

/** Password-account sandbox; separate ports and browser storage from the owner's app. */
export default mergeConfig(
  base,
  defineConfig({
    server: {
      host: '127.0.0.1',
      port: 5184,
      strictPort: true,
      proxy: { '/api': { target: 'http://127.0.0.1:8798', changeOrigin: true } },
    },
  }),
);
