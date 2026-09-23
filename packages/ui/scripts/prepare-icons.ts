/**
 * Writes every file-based copy of the Komodoit mark from `src/logo.ts`, each one the white
 * mark on the rounded indigo-to-violet tile:
 *
 *  - the portal favicon, as SVG;
 *  - the apple-touch icon, square-cornered because iOS rounds and shadows it itself;
 *  - the extension's 16/48/128 icons.
 *
 * Run: pnpm --filter @komodoit/ui prepare:icons
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
  writeFileSync(resolve(PORTAL_PUBLIC, 'favicon.svg'), logoSvg({ inset: 9 }) + '\n');
  console.log('portal/public/favicon.svg');

  await png(logoSvg({ inset: 10, radius: 0 }), 180, resolve(PORTAL_PUBLIC, 'apple-touch-icon.png'));

  // Small sizes get a tighter inset so the dragon is not lost at 16px.
  await png(logoSvg({ inset: 5 }), 16, resolve(EXTENSION_ICONS, 'icon16.png'));
  await png(logoSvg({ inset: 8 }), 48, resolve(EXTENSION_ICONS, 'icon48.png'));
  await png(logoSvg({ inset: 9 }), 128, resolve(EXTENSION_ICONS, 'icon128.png'));
}

await main();
