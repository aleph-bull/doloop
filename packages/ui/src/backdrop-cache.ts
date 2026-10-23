import type { BlurredPhoto } from './glass-image';

/**
 * Blurred backgrounds kept between visits (2026-10-23, the owner's ask): the background's own
 * blur, and the glass cards' image, are worked out once and kept in the browser's Cache
 * Storage, so opening or reloading the app shows them straight from there instead of
 * blurring the photo again.
 *
 * Kept per browser only, never sent anywhere. Without Cache Storage (plain http on another
 * machine, a private window that refuses it) the photo is simply blurred on each visit.
 */

const CACHE = 'komodon-backdrop-1';
/** Not a real address: Cache Storage keys requests by URL, and wants http or https. */
const BASE = 'https://backdrop.invalid';
/** How many of each kind to keep: the newest, and a couple to switch back to. */
const KEEP = 3;

export type BlurKind = 'photo' | 'glass';

async function open(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(CACHE);
  } catch {
    return null;
  }
}

/** A short name for a long image address (an upload is a whole data URL). FNV-1a. */
export function sourceKey(src: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}.${src.length.toString(36)}`;
}

/**
 * The blurred image kept under `key`, or `make`'s, kept for next time. Null when `make`
 * can't make one.
 */
export async function cachedBlur(
  kind: BlurKind,
  key: string,
  make: () => Promise<BlurredPhoto | null>,
): Promise<BlurredPhoto | null> {
  const cache = await open();
  const url = `${BASE}/${kind}/${encodeURIComponent(key)}`;
  if (cache) {
    try {
      const hit = await cache.match(url);
      const width = Number(hit?.headers.get('x-width'));
      const height = Number(hit?.headers.get('x-height'));
      if (hit && width > 0 && height > 0) return { blob: await hit.blob(), width, height };
    } catch {
      /* made again below */
    }
  }
  const made = await make();
  if (made && cache) void keep(cache, kind, url, made);
  return made;
}

async function keep(cache: Cache, kind: BlurKind, url: string, image: BlurredPhoto) {
  try {
    const prefix = `${BASE}/${kind}/`;
    const older = (await cache.keys()).filter((r) => r.url.startsWith(prefix) && r.url !== url);
    for (const r of older.slice(0, Math.max(0, older.length - (KEEP - 1)))) await cache.delete(r);
    await cache.put(
      url,
      new Response(image.blob, {
        headers: {
          'content-type': image.blob.type,
          'x-width': String(image.width),
          'x-height': String(image.height),
        },
      }),
    );
  } catch {
    /* full or refused: it is made again next time */
  }
}

/** Forget every kept image (signing out: an upload's blurred copy is someone's own photo). */
export async function clearBackdropCache(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') await caches.delete(CACHE);
  } catch {
    /* nothing kept */
  }
}
