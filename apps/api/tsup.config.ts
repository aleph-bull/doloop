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
});
