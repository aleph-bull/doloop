/**
 * The Doloop mark: one ribbon looped into a d, the stem passing over the crossbar.
 *
 * The path was traced from the designer's 2000px PNG and normalised to a 100-unit box
 * (the trace differs from the original by under 0.2% of its pixels). The over-and-under
 * is carried by a soft shade on the crossbar either side of the stem, as in the original;
 * it is drawn as two radial gradients clipped to the ribbon, not baked into the path, so
 * the mark can take any colour.
 *
 * Everything that draws the mark reads from here: the `LogoMark` component, the favicon
 * and the raster icons written by `scripts/prepare-icons.ts`.
 */

export const LOGO_VIEWBOX = '0 0 100 100';

/** Outer outline plus the two counters; draw with the even-odd fill rule. */
export const LOGO_PATH =
  'M62.3 0.04C58.75 0.23 56.06 0.71 53.31 1.62C45.36 4.26 39.69 10.24 36.75 19.09C34.24 26.64 33.07 37.04 32.93 53.1L32.9 57.45 32.62 57.45C32.2 57.45 29.44 57.62 28.16 57.72C16.94 58.61 11.2 60.91 7.92 65.83C6.12 68.52 5.34 71.58 4.82 78.07C4.15 86.34 6.1 91.82 11 95.52C16.64 99.78 26.76 101.22 33.96 98.79C40.52 96.58 44.14 91.46 44.94 83.27C45.14 81.2 45.17 78.59 45.06 72.75C45.02 70.88 45.01 69.34 45.03 69.32C45.14 69.21 58.39 69.69 60.98 69.9C61.39 69.93 62.94 69.99 64.42 70.02C73.19 70.22 78.21 69.44 82.76 67.17C90.77 63.18 94.64 54.94 95.28 40.51C95.36 38.74 95.32 33.75 95.22 32.14C94.56 21.87 92.85 14.98 89.83 10.43C88.82 8.91 87.32 7.26 86.06 6.28C85.22 5.64 83.28 4.38 82.73 4.13C81.23 3.43 80.86 3.28 78.04 2.29C74.72 1.13 71.46 0.44 67.86 0.15C66.77 0.06 63.18-0.01 62.3 0.04M62.51 12.01C54.01 12.55 49.69 16.34 47.4 25.28C45.75 31.7 44.89 41.92 44.88 55.12L44.88 57.31 47.05 57.35C50.42 57.42 54.48 57.57 59.78 57.84C70.87 58.41 75.37 57.95 78.31 55.95C81.13 54.04 82.62 49.67 83.26 41.47C83.36 40.13 83.36 34.18 83.26 32.62C82.78 25.53 81.67 20.1 80.13 17.48C79.15 15.79 78.13 15.08 75.1 13.95C72.18 12.87 69.98 12.36 67.06 12.09C66.37 12.03 63.13 11.97 62.51 12.01M32.14 69.46C25.36 69.84 20.99 70.56 18.9 71.64C17.77 72.23 17.46 72.87 17.18 75.28C17.11 75.86 17.01 76.61 16.96 76.96C16.69 78.98 16.58 81.89 16.75 83C17.05 85.02 17.62 85.81 19.34 86.62C22.74 88.22 28.1 88.47 30.85 87.16C32.05 86.59 32.66 85.21 33.01 82.29C33.14 81.26 33.16 77.92 33.07 72.64L33.02 69.42 32.74 69.43C32.59 69.44 32.32 69.45 32.14 69.46';

/**
 * The shade on the crossbar. Two circles centred on the stem's edges, darkest right at
 * the edge and gone about a quarter of the mark's width out. The rectangles keep each
 * one off the stem, so the stem reads as lying on top.
 */
export const LOGO_SHADE = {
  cy: 63.67,
  r: 23.94,
  stemLeft: 32.97,
  stemRight: 44.91,
  top: 55.6,
  bottom: 71.75,
  /** Offset, opacity. Fitted to the original's falloff. */
  stops: [
    [0, 0.153],
    [0.18, 0.153],
    [0.3, 0.137],
    [0.4, 0.11],
    [0.5, 0.078],
    [0.75, 0.03],
    [1, 0],
  ] as ReadonlyArray<readonly [number, number]>,
} as const;

export interface LogoSvgOptions {
  /** Ribbon colour. */
  color: string;
  /** Colour of the shade at the crossing: darker than `color` on a light mark, lighter on a dark one. */
  shade: string;
  /** A rounded-square tile behind the mark, for app icons. */
  tile?: { fill: string; radius: number; inset: number };
  /** Extra CSS inside the SVG, e.g. a `prefers-color-scheme` swap for the favicon. */
  css?: string;
  /** Prefix for gradient and clip ids. */
  idPrefix?: string;
}

/** The mark as a standalone SVG document, for files. The React component renders the same thing. */
export function logoSvg({ color, shade, tile, css, idPrefix = 'dl' }: LogoSvgOptions): string {
  const s = LOGO_SHADE;
  const stops = s.stops
    .map(
      ([o, a]) => `<stop offset="${o}" stop-color="${shade}" stop-opacity="${a}" class="shade"/>`,
    )
    .join('');
  const grad = (id: string, cx: number) =>
    `<radialGradient id="${id}" cx="${cx}" cy="${s.cy}" r="${s.r}" gradientUnits="userSpaceOnUse">${stops}</radialGradient>`;
  const h = s.bottom - s.top;
  // With a tile, the 100-unit mark is scaled into the tile minus its inset.
  const size = 100;
  const inner = tile ? size - tile.inset * 2 : size;
  const k = inner / 100;
  const off = tile ? tile.inset : 0;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">`,
    '<title>Doloop</title>',
    css ? `<style>${css}</style>` : '',
    '<defs>',
    `<clipPath id="${idPrefix}-clip"><path d="${LOGO_PATH}" clip-rule="evenodd"/></clipPath>`,
    grad(`${idPrefix}-l`, s.stemLeft),
    grad(`${idPrefix}-r`, s.stemRight),
    '</defs>',
    tile
      ? `<rect width="${size}" height="${size}" rx="${tile.radius}" fill="${tile.fill}" class="tile"/>`
      : '',
    `<g transform="translate(${off} ${off}) scale(${k})">`,
    `<path d="${LOGO_PATH}" fill="${color}" fill-rule="evenodd" class="mark"/>`,
    `<g clip-path="url(#${idPrefix}-clip)">`,
    `<rect x="0" y="${s.top}" width="${s.stemLeft}" height="${h}" fill="url(#${idPrefix}-l)"/>`,
    `<rect x="${s.stemRight}" y="${s.top}" width="${100 - s.stemRight}" height="${h}" fill="url(#${idPrefix}-r)"/>`,
    '</g></g></svg>',
  ].join('');
}
