/**
 * Writes the picker thumbnails for the shipped background photographs.
 *
 * The pickers used to paint each photo from its 20px LQIP, which is a placeholder, not a
 * preview — scaled up to a 200px tile it is just a smear. A thumbnail is 640px wide: sharp
 * on a 2x screen at the largest tile size, and small enough that a whole picker still
 * loads in a blink.
 *
 * Thumbnails are derived from the shipped 2560px WebPs, so this runs without the source
 * photos. `prepare-backgrounds.ts` calls it after writing those.
 *
 * Run: pnpm --filter @komodoit/ui prepare:thumbs
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHOTO_BACKGROUNDS, type PhotoBackground } from '../src/photos.generated';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(HERE, '../../../apps/portal/public');

const THUMB_WIDTH = 640;
const THUMB_QUALITY = 74;

type ThumbSource = Pick<PhotoBackground, 'id' | 'src' | 'thumb'>;

export async function prepareThumbs(photos: ThumbSource[] = PHOTO_BACKGROUNDS): Promise<void> {
  mkdirSync(join(PUBLIC_DIR, 'backgrounds/thumbs'), { recursive: true });
  let totalBytes = 0;
  for (const photo of photos) {
    const out = join(PUBLIC_DIR, photo.thumb);
    const info = await sharp(join(PUBLIC_DIR, photo.src))
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toFile(out);
    totalBytes += info.size;
    console.log(`${photo.id.padEnd(14)} ${(info.size / 1024).toFixed(0).padStart(4)} KB thumb`);
  }
  console.log(`${photos.length} thumbs, ${(totalBytes / 1024).toFixed(0)} KB total`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareThumbs();
}
