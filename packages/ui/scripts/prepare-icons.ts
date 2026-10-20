/**
 * Writes every file-based copy of the Komogon mark from `src/logo.ts`, each one the white
 * mark on the rounded indigo-to-violet tile:
 *
 *  - the portal favicon, as SVG;
 *  - the apple-touch icon, square-cornered because iOS rounds and shadows it itself;
 *  - the web app manifest icons (192/512, plus a full-bleed maskable 512 that Android crops
 *    to its own shape, so the face sits inside the central safe zone);
 *  - the extension's 16/48/128 icons.
 *
 * Run: pnpm --filter @komogon/ui prepare:icons
 */
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logoSvg } from '../src/logo';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORTAL_PUBLIC = resolve(HERE, '../../../apps/portal/public');
const EXTENSION_ICONS = resolve(HERE, '../../../apps/extension/public/icons');

async function png(svg: string, size: number, out: string) {
  // Rasterise well above the target size, then downsample, for clean edges at 16px.
  await sharp(Buffer.from(svg), { density: Math.max(72, (72 * size * 4) / 64) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`${out.replace(/\\/g, '/').split('/').slice(-3).join('/')}  ${size}px`);
}

async function main() {
  writeFileSync(resolve(PORTAL_PUBLIC, 'favicon.svg'), logoSvg({ inset: 11 }) + '\n');
  console.log('portal/public/favicon.svg');

  await png(logoSvg({ inset: 12, radius: 0 }), 180, resolve(PORTAL_PUBLIC, 'apple-touch-icon.png'));
  await png(logoSvg({ inset: 11 }), 192, resolve(PORTAL_PUBLIC, 'icon-192.png'));
  await png(logoSvg({ inset: 11 }), 512, resolve(PORTAL_PUBLIC, 'icon-512.png'));
  await png(logoSvg({ inset: 17, radius: 0 }), 512, resolve(PORTAL_PUBLIC, 'icon-maskable-512.png'));

  // Small sizes get a tighter inset so the face is not lost at 16px.
  await png(logoSvg({ inset: 6 }), 16, resolve(EXTENSION_ICONS, 'icon16.png'));
  await png(logoSvg({ inset: 10 }), 48, resolve(EXTENSION_ICONS, 'icon48.png'));
  await png(logoSvg({ inset: 11 }), 128, resolve(EXTENSION_ICONS, 'icon128.png'));
}

await main();
