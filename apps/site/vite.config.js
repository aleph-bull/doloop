import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const page = (path) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  server: { port: 5190, strictPort: true },
  build: {
    target: 'es2022',
    // The homepage and the docs, each its own page.
    rollupOptions: {
      input: { main: page('./index.html'), docs: page('./docs/index.html') },
    },
  },
});
