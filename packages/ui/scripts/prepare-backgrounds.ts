/**
 * Turns the source wallpaper photographs into shipped assets.
 *
 * For each photo it writes a 2560px-wide WebP into the portal's public folder, and records
 * two things the app needs at runtime but should never compute in the browser:
 *
 *  - the average colour, which drives the glass fill and text colour so that text stays
 *    above 4.5:1 on top of the photo (the same maths the custom-upload path does live);
 *  - a 20px LQIP as a data URL, so a background paints instantly instead of flashing.
 *
 * Both land in `src/photos.generated.ts`, which is committed. That keeps `pnpm check`,
 * the contrast audit and the extension working without the source photos present.
 *
 * Run: pnpm --filter @komogon/ui prepare:backgrounds -- --src "C:/path/to/photos"
 */
import sharp from 'sharp';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareThumbs } from './prepare-thumbs';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_SRC = resolve(HERE, '../src');
const PUBLIC_DIR = resolve(HERE, '../../../apps/portal/public/backgrounds');

/** Longest edge of the shipped image. Backgrounds sit behind glass, so this is plenty. */
const WIDTH = 2560;
const QUALITY = 72;
const LQIP_WIDTH = 20;

export interface PhotoSource {
  file: string;
  id: string;
  name: string;
  category: string;
  /** Photographer, for the credits file. */
  credit: string;
  /** Where it came from, so the licence can be checked later. */
  source: string;
}

/**
 * The catalogue. `file` is the name as downloaded; ids are what the app stores, so they
 * must not change once a user has picked one.
 */
const PHOTOS: PhotoSource[] = [
  // --- mountains ---
  {
    file: 'clay-banks-u27Rrbs9Dwc-unsplash.jpg',
    id: 'fuji',
    name: 'Fuji',
    category: 'mountains',
    credit: 'Clay Banks',
    source: 'Unsplash',
  },
  {
    file: 'john-towner-JgOeRuGD_Y4-unsplash.jpg',
    id: 'alpenglow',
    name: 'Alpenglow',
    category: 'mountains',
    credit: 'John Towner',
    source: 'Unsplash',
  },
  {
    file: 'markus-spiske-FzrjgIId6NU-unsplash.jpg',
    id: 'alpine-pass',
    name: 'Alpine Pass',
    category: 'mountains',
    credit: 'Markus Spiske',
    source: 'Unsplash',
  },
  {
    file: 'luke-vodell-C7FXIG9DoaU-unsplash.jpg',
    id: 'kirkjufell',
    name: 'Kirkjufell',
    category: 'mountains',
    credit: 'Luke Vodell',
    source: 'Unsplash',
  },
  // --- night ---
  {
    file: '26-Tahoe-Beach-Night.png',
    id: 'still-water',
    name: 'Still Water',
    category: 'night',
    credit: 'Unknown',
    source: 'Supplied by the user — licence not verified',
  },
  {
    file: 'benjamin-voros-phIFdC6lA4E-unsplash.jpg',
    id: 'milky-way',
    name: 'Milky Way',
    category: 'night',
    credit: 'Benjamin Voros',
    source: 'Unsplash',
  },
  {
    file: 'jonatan-pie-3l3RwQdHRHg-unsplash.jpg',
    id: 'ice-canyon',
    name: 'Ice Canyon',
    category: 'night',
    credit: 'Jonatan Pie',
    source: 'Unsplash',
  },
  // --- coast ---
  {
    file: 'luca-micheli-ruWkmt3nU58-unsplash.jpg',
    id: 'vestrahorn',
    name: 'Vestrahorn',
    category: 'coast',
    credit: 'Luca Micheli',
    source: 'Unsplash',
  },
  {
    file: 'cassie-boca-gFyy2Po7T-k-unsplash.jpg',
    id: 'stormlight',
    name: 'Stormlight',
    category: 'coast',
    credit: 'Cassie Boca',
    source: 'Unsplash',
  },
  {
    file: 'ishan-seefromthesky-BMJWpck6eQA-unsplash.jpg',
    id: 'shipwreck',
    name: 'Shipwreck',
    category: 'coast',
    credit: 'Ishan @seefromthesky',
    source: 'Unsplash',
  },
  // --- forest ---
  {
    file: 'john-towner-3Kv48NS4WUU-unsplash.jpg',
    id: 'redwood',
    name: 'Redwood',
    category: 'forest',
    credit: 'John Towner',
    source: 'Unsplash',
  },
  {
    file: 'philipp-raifer-VkemCRJ671s-unsplash.jpg',
    id: 'frozen-lake',
    name: 'Frozen Lake',
    category: 'forest',
    credit: 'Philipp Raifer',
    source: 'Unsplash',
  },
  // --- open country ---
  {
    file: 'arindam-saha-PwzISwC2kLs-unsplash.jpg',
    id: 'cloud-valley',
    name: 'Cloud Valley',
    category: 'country',
    credit: 'Arindam Saha',
    source: 'Unsplash',
  },
  {
    file: 'will-bolding-dLHqZLijR0c-unsplash.jpg',
    id: 'ridgeline',
    name: 'Ridgeline',
    category: 'country',
    credit: 'Will Bolding',
    source: 'Unsplash',
  },
  {
    file: 'axi-aimee-46dgbaKZTjk-unsplash.jpg',
    id: 'emberlight',
    name: 'Emberlight',
    category: 'country',
    credit: 'Axi Aimee',
    source: 'Unsplash',
  },
  {
    file: 'jeremy-bishop-v1ySnKYCtrE-unsplash.jpg',
    id: 'badlands',
    name: 'Badlands',
    category: 'country',
    credit: 'Jeremy Bishop',
    source: 'Unsplash',
  },
  // --- cities ---
  {
    file: 'sheng-l-q2dUSl9S4Xg-unsplash.jpg',
    id: 'hallstatt',
    name: 'Hallstatt',
    category: 'cities',
    credit: 'Sheng L',
    source: 'Unsplash',
  },
  {
    file: 'simon-zhu-4hluhoRJokI-unsplash.jpg',
    id: 'victoria-peak',
    name: 'Victoria Peak',
    category: 'cities',
    credit: 'Simon Zhu',
    source: 'Unsplash',
  },
  // --- minimal ---
  {
    file: 'valery-rabchenyuk-5I_oFqB0n6g-unsplash.jpg',
    id: 'lanterns',
    name: 'Lanterns',
    category: 'minimal',
    credit: 'Valery Rabchenyuk',
    source: 'Unsplash',
  },
  // --- added 2026-09-22; files as downloaded from Unsplash, Pexels and Pixabay ---
  {
    file: 'lucian-qxO2PBn7eKU-unsplash.jpg',
    id: 'summit-glow',
    name: 'Summit Glow',
    category: 'mountains',
    credit: 'Lucian',
    source: 'Unsplash',
  },
  {
    file: 'pexels-andriy-nestruiev-288919368-16300540.jpg',
    id: 'highland',
    name: 'Highland',
    category: 'mountains',
    credit: 'Andriy Nestruiev',
    source: 'Pexels',
  },
  {
    file: 'urban-vintage-78A265wPiO4-unsplash.jpg',
    id: 'lookout',
    name: 'Lookout',
    category: 'mountains',
    credit: 'Urban Vintage',
    source: 'Unsplash',
  },
  {
    file: 'charlvera-polar-lights-5858656_1920.jpg',
    id: 'polar-lights',
    name: 'Polar Lights',
    category: 'night',
    credit: 'charlvera',
    source: 'Pixabay',
  },
  {
    file: 'felix-mittermeier-milky-way-2695569_1920.jpg',
    id: 'star-field',
    name: 'Star Field',
    category: 'night',
    credit: 'Felix Mittermeier',
    source: 'Pixabay',
  },
  {
    file: 'mark-basarab-1OtUkD_8svc-unsplash.jpg',
    id: 'canyon-stars',
    name: 'Canyon Stars',
    category: 'night',
    credit: 'Mark Basarab',
    source: 'Unsplash',
  },
  {
    file: 'afrah-puUx-3kFVbg-unsplash.jpg',
    id: 'shoreline',
    name: 'Shoreline',
    category: 'coast',
    credit: 'Afrah',
    source: 'Unsplash',
  },
  {
    file: 'jatocreate-beach-7436794_1920.jpg',
    id: 'pier',
    name: 'Pier at Dawn',
    category: 'coast',
    credit: 'jatocreate',
    source: 'Pixabay',
  },
  {
    file: 'michelle-spollen-dC2FsjoXsPQ-unsplash.jpg',
    id: 'kualoa',
    name: 'Kualoa',
    category: 'coast',
    credit: 'Michelle Spollen',
    source: 'Unsplash',
  },
  {
    file: 'pexels-francesco-ungaro-20422519.jpg',
    id: 'rain-front',
    name: 'Rain Front',
    category: 'coast',
    credit: 'Francesco Ungaro',
    source: 'Pexels',
  },
  {
    file: 'jplenio-forest-3804001_1920.jpg',
    id: 'autumn',
    name: 'Autumn',
    category: 'forest',
    credit: 'jplenio',
    source: 'Pixabay',
  },
  {
    file: 'pexels-blitzboy-948407.jpg',
    id: 'pine-ridge',
    name: 'Pine Ridge',
    category: 'forest',
    credit: 'blitzboy',
    source: 'Pexels',
  },
  {
    file: 'pexels-eklect-5383325.jpg',
    id: 'cloudbreak',
    name: 'Cloudbreak',
    category: 'country',
    credit: 'eklect',
    source: 'Pexels',
  },
  {
    file: 'pexels-jedrzej-koralewski-14125120-20309749.jpg',
    id: 'tundra',
    name: 'Tundra',
    category: 'country',
    credit: 'Jędrzej Koralewski',
    source: 'Pexels',
  },
  {
    file: 'pexels-mimi-3458731-31994168.jpg',
    id: 'wheatland',
    name: 'Wheatland',
    category: 'country',
    credit: 'mimi',
    source: 'Pexels',
  },
  {
    file: 'pexels-jacky-chiu-1418472-15172659.jpg',
    id: 'harbour-lights',
    name: 'Harbour Lights',
    category: 'cities',
    credit: 'Jacky Chiu',
    source: 'Pexels',
  },
  {
    file: 'pexels-jimmy-liao-3615017-16705980.jpg',
    id: 'taipei',
    name: 'Taipei',
    category: 'cities',
    credit: 'Jimmy Liao',
    source: 'Pexels',
  },
  {
    file: 'pexels-loudpose-15685014.jpg',
    id: 'rooftops',
    name: 'Rooftops',
    category: 'cities',
    credit: 'loudpose',
    source: 'Pexels',
  },
  {
    file: 'pexels-ruiz-15275312.jpg',
    id: 'tokyo-haze',
    name: 'Tokyo Haze',
    category: 'cities',
    credit: 'ruiz',
    source: 'Pexels',
  },
  {
    file: 'pexels-codioful-6985001.jpg',
    id: 'sherbet',
    name: 'Sherbet',
    category: 'abstract',
    credit: 'Codioful (Gradienta)',
    source: 'Pexels',
  },
  {
    file: 'pexels-codioful-6985120.jpg',
    id: 'lagoon',
    name: 'Lagoon',
    category: 'abstract',
    credit: 'Codioful (Gradienta)',
    source: 'Pexels',
  },
  {
    file: 'pexels-codioful-6985132.jpg',
    id: 'neon',
    name: 'Neon',
    category: 'abstract',
    credit: 'Codioful (Gradienta)',
    source: 'Pexels',
  },
  {
    file: 'pexels-codioful-6985259.jpg',
    id: 'spectrum',
    name: 'Spectrum',
    category: 'abstract',
    credit: 'Codioful (Gradienta)',
    source: 'Pexels',
  },
  {
    file: 'pexels-codioful-7134981.jpg',
    id: 'opal',
    name: 'Opal',
    category: 'abstract',
    credit: 'Codioful (Gradienta)',
    source: 'Pexels',
  },
  {
    file: 'pexels-codioful-7135028.jpg',
    id: 'nebula',
    name: 'Nebula',
    category: 'abstract',
    credit: 'Codioful (Gradienta)',
    source: 'Pexels',
  },
  {
    file: 'pexels-codioful-7135037.jpg',
    id: 'velvet',
    name: 'Velvet',
    category: 'abstract',
    credit: 'Codioful (Gradienta)',
    source: 'Pexels',
  },
  {
    file: 'pexels-codioful-7135053.jpg',
    id: 'prism',
    name: 'Prism',
    category: 'abstract',
    credit: 'Codioful (Gradienta)',
    source: 'Pexels',
  },
  {
    file: 'pexels-martinpechy-2078266.jpg',
    id: 'sea-glass',
    name: 'Sea Glass',
    category: 'abstract',
    credit: 'Martin Péchy',
    source: 'Pexels',
  },
  {
    file: 'pexels-steve-26756127.jpg',
    id: 'swell',
    name: 'Swell',
    category: 'abstract',
    credit: 'Steve',
    source: 'Pexels',
  },
];

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const src = argValue('--src') ?? process.env.KOMOGON_BACKGROUND_SRC;
  if (!src) {
    console.error('Pass --src <folder containing the source photos>.');
    process.exit(1);
  }
  mkdirSync(PUBLIC_DIR, { recursive: true });

  const rows: string[] = [];
  const credits: string[] = [];
  let totalBytes = 0;

  for (const photo of PHOTOS) {
    const input = join(src, photo.file);
    if (!existsSync(input)) {
      console.error(`missing: ${input}`);
      process.exit(1);
    }
    const out = join(PUBLIC_DIR, `${photo.id}.webp`);
    const info = await sharp(input)
      .resize({ width: WIDTH, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toFile(out);
    totalBytes += info.size;

    // Average colour, sampled the same way the browser samples a custom upload.
    const { data, info: statsInfo } = await sharp(input)
      .resize(16, 16, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let r = 0;
    let g = 0;
    let b = 0;
    const pixels = statsInfo.width * statsInfo.height;
    for (let i = 0; i < data.length; i += 3) {
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
    }
    const avg: [number, number, number] = [
      Math.round(r / pixels),
      Math.round(g / pixels),
      Math.round(b / pixels),
    ];

    const lqipBuf = await sharp(input)
      .resize({ width: LQIP_WIDTH })
      .webp({ quality: 45, alphaQuality: 0 })
      .toBuffer();
    const lqip = `data:image/webp;base64,${lqipBuf.toString('base64')}`;

    rows.push(
      [
        `  {`,
        `    id: '${photo.id}',`,
        `    name: '${photo.name.replace(/'/g, "\\'")}',`,
        `    category: '${photo.category}',`,
        `    src: 'backgrounds/${photo.id}.webp',`,
        `    thumb: 'backgrounds/thumbs/${photo.id}.webp',`,
        `    avg: [${avg.join(', ')}],`,
        `    lqip:\n      '${lqip}',`,
        `  },`,
      ].join('\n'),
    );
    credits.push(`| ${photo.name} | ${photo.credit} | ${photo.source} |`);
    console.log(
      `${photo.id.padEnd(14)} ${(info.size / 1024).toFixed(0).padStart(5)} KB  avg rgb(${avg.join(' ')})  lqip ${lqipBuf.length} B`,
    );
  }

  const generated = `/**
 * GENERATED by scripts/prepare-backgrounds.ts — do not edit by hand.
 *
 * \`avg\` is the photograph's average colour, used to pick the glass fill and text colour
 * without sampling in the browser. \`lqip\` is a 20px placeholder shown while the full
 * image loads. \`thumb\` is the picker preview, written by scripts/prepare-thumbs.ts.
 */

export interface PhotoBackground {
  id: string;
  name: string;
  category: string;
  /** Path relative to the app root; the extension prefixes it with the portal origin. */
  src: string;
  /** 640px picker thumbnail, same path convention as \`src\`. */
  thumb: string;
  avg: [number, number, number];
  lqip: string;
}

export const PHOTO_BACKGROUNDS: PhotoBackground[] = [
${rows.join('\n')}
];
`;
  writeFileSync(join(UI_SRC, 'photos.generated.ts'), generated);

  writeFileSync(
    join(PUBLIC_DIR, 'CREDITS.md'),
    [
      '# Background photographs',
      '',
      'Generated by `packages/ui/scripts/prepare-backgrounds.ts`.',
      '',
      'Photographs from Unsplash, Pexels and Pixabay are used under their own licences,',
      'each of which permits free use, commercial included, without attribution. They are',
      'credited here anyway, by the name or handle the file was downloaded under.',
      '',
      '| Background | Photographer | Source |',
      '| --- | --- | --- |',
      ...credits,
      '',
    ].join('\n'),
  );

  console.log(
    `\n${PHOTOS.length} photos, ${(totalBytes / 1024 / 1024).toFixed(1)} MB total -> ${PUBLIC_DIR}`,
  );

  // From the list just written, not the imported module, which predates this run.
  await prepareThumbs(
    PHOTOS.map((p) => ({
      id: p.id,
      src: `backgrounds/${p.id}.webp`,
      thumb: `backgrounds/thumbs/${p.id}.webp`,
    })),
  );
}

await main();
