/**
 * Writes every file-based copy of the Doloop mark from `src/logo.ts`:
 *
 *  - the portal favicon, an SVG that follows the browser's light or dark tab strip;
 *  - the apple-touch icon, opaque and square because iOS rounds and shadows it itself;
 *  - the extension's 16/48/128 icons, on a dark tile so the white mark holds up on a
 *    light toolbar as well as a dark one.
 *
 * Run: pnpm --filter @doloop/ui prepare:icons
 */
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logoSvg } from '../src/logo';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORTAL_PUBLIC = resolve(HERE, '../../../apps/portal/public');
const EXTENSION_ICONS = resolve(HERE, '../../../apps/extension/public/icons');

/** The tile: the graphite the dark theme is built on. */
const TILE = '#15171c';
const INK = '#15171c';

async function png(svg: string, size: number, out: string) {
  await sharp(Buffer.from(svg), { density: 72 * Math.max(1, size / 100) * 4 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`${out.replace(/\\/g, '/').split('/').slice(-3).join('/')}  ${size}px`);
}

async function main() {
  const favicon = logoSvg({
    color: INK,
    shade: '#fff',
    css: [
      '@media (prefers-color-scheme: dark){',
      '.mark{fill:#fff}',
      '.shade{stop-color:#000}',
      '}',
    ].join(''),
  });
  writeFileSync(resolve(PORTAL_PUBLIC, 'favicon.svg'), favicon + '\n');
  console.log('portal/public/favicon.svg');

  const touch = logoSvg({
    color: '#fff',
    shade: '#000',
    tile: { fill: TILE, radius: 0, inset: 18 },
  });
  await png(touch, 180, resolve(PORTAL_PUBLIC, 'apple-touch-icon.png'));

  // Small sizes get a tighter inset so the ribbon is not lost at 16px.
  const icon = (inset: number) =>
    logoSvg({ color: '#fff', shade: '#000', tile: { fill: TILE, radius: 22, inset } });
  await png(icon(9), 16, resolve(EXTENSION_ICONS, 'icon16.png'));
  await png(icon(15), 48, resolve(EXTENSION_ICONS, 'icon48.png'));
  await png(icon(17), 128, resolve(EXTENSION_ICONS, 'icon128.png'));
}

await main();
