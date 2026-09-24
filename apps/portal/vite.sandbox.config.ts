import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

/**
 * The portal against the sandbox API (`scripts/local/sandbox-api.mjs`), which keeps
 * throwaway data: 5183 proxying to 8797, clear of the always-on copy's 5173 and 8787.
 * A separate origin, so its sign-in and cache never mix with the real one.
 */
export default mergeConfig(
  base,
  defineConfig({
    server: {
      port: 5183,
      proxy: { '/api': { target: 'http://localhost:8797', changeOrigin: true } },
    },
  }),
);
