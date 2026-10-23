import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const page = (path) => fileURLToPath(new URL(path, import.meta.url));

/*
 * `import text from './content/docs.html?sealed'` gives the file's text scrambled (each byte
 * XORed with a key, then base64), so the docs and the changelog never sit in a page or a
 * script as readable text for bots that only fetch. src/sealed.js turns it back in the
 * browser. A deterrent, not encryption: the key ships with the page.
 */
const SEAL_KEY = 'komodon-study';

function sealedText() {
  const suffix = '?sealed';
  return {
    name: 'komodon-sealed-text',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.endsWith(suffix)) return null;
      const resolved = await this.resolve(source.slice(0, -suffix.length), importer);
      return resolved ? resolved.id + suffix : null;
    },
    load(id) {
      if (!id.endsWith(suffix)) return null;
      const file = id.slice(0, -suffix.length);
      this.addWatchFile(file);
      const bytes = Buffer.from(readFileSync(file, 'utf8'), 'utf8');
      const key = Buffer.from(SEAL_KEY, 'utf8');
      for (let i = 0; i < bytes.length; i++) bytes[i] ^= key[(i * 7) % key.length] ^ (i & 0xff);
      return `export default ${JSON.stringify(bytes.toString('base64'))};`;
    },
  };
}

export default defineConfig({
  plugins: [sealedText()],
  server: { port: 5190, strictPort: true },
  build: {
    target: 'es2022',
    // The homepage and the changelog, each its own page. The docs (docs/index.html) are off
    // for now (the owner, 2026-10-22): not built, and /docs redirects home (vercel.json). To
    // bring them back, add `docs: page('./docs/index.html')` here, drop the redirects and put
    // the Docs links back in the homepage and changelog.
    rollupOptions: {
      input: {
        main: page('./index.html'),
        changelog: page('./changelog/index.html'),
      },
    },
  },
});
