/**
 * Writes every copy of the Komogon mark from the designer's two PNGs in `design/brand`:
 * `komo3.0.png` for the bigger sizes and `komo3.0small.png`, drawn to stay clear when tiny,
 * for anything `LOGO_SMALL_MAX` px or under. Each icon is the white mark on the rounded
 * indigo-to-violet tile:
 *
 *  - `src/logo-images.generated.ts`: both marks, bare, as data URLs for `LogoMark` and the
 *    timelapse;
 *  - the portal's tab icons (16 and 32, small mark), the apple-touch icon, square-cornered
 *    because iOS rounds and shadows it itself, and the web app manifest icons (192/512, plus
 *    a full-bleed maskable 512 that Android crops to its own shape, so the face sits inside
 *    the central safe zone);
 *  - the extension's 16/48/128 icons;
 *  - the homepage's copies (apps/site): the same tab, apple-touch, 192 and 512 icons, and its
 *    logo at two sizes (`logo-small.png` up to 32px on the page, `logo.png` above);
 *  - a `favicon.ico` (16/32/48) for the portal and the homepage, for Google's search results.
 *
 * Run: pnpm --filter @komogon/ui prepare:icons
 */
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The tile behind the mark, as on the original favicon: 64 units, corners of 14.5. */
const LOGO_TILE = { from: '#5b55eb', to: '#8a5cf6', size: 64, radius: 14.5 } as const;

const HERE = dirname(fileURLToPath(import.meta.url));
const BRAND = resolve(HERE, '../../../design/brand');
const GENERATED = resolve(HERE, '../src/logo-images.generated.ts');
const PORTAL_PUBLIC = resolve(HERE, '../../../apps/portal/public');
const EXTENSION_ICONS = resolve(HERE, '../../../apps/extension/public/icons');
const SITE_PUBLIC = resolve(HERE, '../../../apps/site/public');

/**
 * The mark cut to the square that just holds the face's width, centred on it vertically,
 * so it fills the same box the old path did.
 */
async function squareMark(file: string): Promise<Buffer> {
  const trimmed = await sharp(resolve(BRAND, file)).trim({ threshold: 0 }).png().toBuffer();
  const { width = 0, height = 0 } = await sharp(trimmed).metadata();
  const side = Math.max(width, height);
  const top = Math.floor((side - height) / 2);
  const left = Math.floor((side - width) / 2);
  return sharp(trimmed)
    .extend({
      top,
      bottom: side - height - top,
      left,
      right: side - width - left,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toBuffer();
}

async function dataUrl(mark: Buffer, size: number): Promise<string> {
  const png = await sharp(mark).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

/**
 * The mark on its tile. `inset` is the space between the tile's edge and the mark and
 * `radius` the corners, both in tile units (the tile is 64). Drawn well above the target size,
 * then downsampled, for clean edges at 16px.
 */
async function tile(
  mark: Buffer,
  size: number,
  inset: number,
  out: string,
  radius: number = LOGO_TILE.radius,
): Promise<Buffer> {
  const t = LOGO_TILE;
  const big = size * Math.ceil(256 / size);
  const side = Math.round((big * (t.size - inset * 2)) / t.size);
  const at = Math.round((big - side) / 2);
  const back = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${big}" height="${big}" viewBox="0 0 ${t.size} ${t.size}">`,
    `<defs><linearGradient id="d" x1="0" y1="0" x2="${t.size}" y2="${t.size}" gradientUnits="userSpaceOnUse">`,
    `<stop offset="0" stop-color="${t.from}"/><stop offset="1" stop-color="${t.to}"/>`,
    '</linearGradient></defs>',
    `<rect width="${t.size}" height="${t.size}" rx="${radius}" fill="url(#d)"/></svg>`,
  ].join('');
  const face = await sharp(mark).resize(side, side).png().toBuffer();
  const drawn = await sharp(Buffer.from(back))
    .composite([{ input: face, left: at, top: at }])
    .png()
    .toBuffer();
  const png = await sharp(drawn).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
  if (out) {
    writeFileSync(out, png);
    console.log(`${out.replace(/\\/g, '/').split('/').slice(-3).join('/')}  ${size}px`);
  }
  return png;
}

/**
 * `favicon.ico` with 16, 32 and 48px tiles (PNG inside, which every current browser and
 * Google read). Google Search shows a site's icon only when it can find one at least 48px
 * square, and some crawlers ask for /favicon.ico without reading the page at all.
 */
async function favicon(normal: Buffer, small: Buffer, out: string) {
  const sizes = [16, 32, 48];
  const pngs = await Promise.all(sizes.map((s) => tile(s <= 32 ? small : normal, s, 11, '')));
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const at = 6 + 16 * i;
    head.writeUInt8(s, at);
    head.writeUInt8(s, at + 1);
    head.writeUInt16LE(1, at + 4);
    head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(pngs[i]!.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += pngs[i]!.length;
  });
  writeFileSync(out, Buffer.concat([head, ...pngs]));
  console.log(`${out.replace(/\\/g, '/').split('/').slice(-3).join('/')}  ${sizes.join('/')}px`);
}

async function main() {
  const normal = await squareMark('komo3.0.png');
  const small = await squareMark('komo3.0small.png');

  writeFileSync(
    GENERATED,
    [
      '/**',
      ' * GENERATED by scripts/prepare-icons.ts from design/brand/komo3.0.png and',
      ' * komo3.0small.png — do not edit by hand.',
      ' *',
      ' * The bare marks, white on clear, each cut to the square that just holds the face.',
      ' */',
      'export const LOGO_PNG =',
      `  '${await dataUrl(normal, 512)}';`,
      '',
      'export const LOGO_SMALL_PNG =',
      `  '${await dataUrl(small, 128)}';`,
      '',
    ].join('\n'),
  );
  console.log('ui/src/logo-images.generated.ts');

  for (const dir of [PORTAL_PUBLIC, SITE_PUBLIC]) {
    await tile(small, 16, 11, resolve(dir, 'favicon-16.png'));
    await tile(small, 32, 11, resolve(dir, 'favicon-32.png'));
    await tile(normal, 180, 12, resolve(dir, 'apple-touch-icon.png'), 0);
    await tile(normal, 512, 11, resolve(dir, 'icon-512.png'));
    // The icon Google shows beside each site in search results (48px and up).
    await tile(normal, 192, 11, resolve(dir, 'icon-192.png'));
    await favicon(normal, small, resolve(dir, 'favicon.ico'));
  }
  await tile(normal, 512, 17, resolve(PORTAL_PUBLIC, 'icon-maskable-512.png'), 0);

  // Three times the size they're shown at: 22-28px in the nav and footer, 64px at the end.
  await tile(small, 96, 11, resolve(SITE_PUBLIC, 'logo-small.png'));
  await tile(normal, 192, 11, resolve(SITE_PUBLIC, 'logo.png'));

  // Small sizes get a tighter inset so the face is not lost at 16px.
  await tile(small, 16, 6, resolve(EXTENSION_ICONS, 'icon16.png'));
  await tile(normal, 48, 10, resolve(EXTENSION_ICONS, 'icon48.png'));
  await tile(normal, 128, 11, resolve(EXTENSION_ICONS, 'icon128.png'));
}

await main();
