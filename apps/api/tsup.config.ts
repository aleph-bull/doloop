import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Bundle workspace packages (they ship TS source), leave real deps external.
  noExternal: ['@komogon/core'],
  // PGlite is a dev dependency, which tsup would bundle, but it loads its .wasm and .data
  // files from beside its own module; bundled, they are missing and it cannot start.
  external: ['@electric-sql/pglite'],
});
