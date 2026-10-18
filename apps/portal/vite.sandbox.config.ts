import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

/**
 * The portal against the sandbox API (`scripts/local/sandbox-api.mjs`), which keeps
 * throwaway data: 5183 proxying to 8797, clear of the always-on copy's 5173 and 8787.
 * A separate origin, so its sign-in and cache never mix with the real one.
 * SANDBOX_PORTAL_PORT and SANDBOX_API_PORT move a second sandbox beside the first.
 */
const port = Number(process.env.SANDBOX_PORTAL_PORT ?? 5183);
const apiPort = process.env.SANDBOX_API_PORT ?? '8797';
export default mergeConfig(
  base,
  defineConfig({
    server: {
      port,
      proxy: { '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true } },
    },
  }),
);
