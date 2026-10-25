import { api, ApiError } from './api';

/**
 * The pictures of the backgrounds people upload, kept in this browser only (owner,
 * 2026-10-25: "make sure custom background storage is local"). IndexedDB, keyed by the
 * background's id: the picture as a data URL, and its tile for the picker under
 * `tile:<id>`. The API keeps just a record of each (the id and a fingerprint), so the first
 * can be free and the next ones cost XP. Another browser has the records but not the
 * pictures, and shows the theme's background instead.
 */

const DB_NAME = 'komogon-backgrounds';
const STORE = 'pictures';
const tileKey = (id: string) => `tile:${id}`;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open local storage'));
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  work: (s: IDBObjectStore) => IDBRequest | void,
): Promise<T> {
  const d = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = work(tx.objectStore(STORE));
    tx.oncomplete = () => {
      d.close();
      resolve((req ? req.result : undefined) as T);
    };
    tx.onerror = () => reject(tx.error ?? new Error('Local storage failed'));
    tx.onabort = () => reject(tx.error ?? new Error('This browser would not keep the picture'));
  });
}

/** The picture, or null when it isn't in this browser. */
export async function localPicture(id: string): Promise<string | null> {
  try {
    return (await run<string | undefined>('readonly', (s) => s.get(id))) ?? null;
  } catch {
    return null;
  }
}

/** The picker's tile, or null when it isn't in this browser. */
export async function localTile(id: string): Promise<string | null> {
  try {
    return (await run<string | undefined>('readonly', (s) => s.get(tileKey(id)))) ?? null;
  } catch {
    return null;
  }
}

export function keepPicture(id: string, dataUrl: string, tile: string): Promise<void> {
  return run('readwrite', (s) => {
    s.put(dataUrl, id);
    s.put(tile, tileKey(id));
  });
}

export async function dropPicture(id: string): Promise<void> {
  await run('readwrite', (s) => {
    s.delete(id);
    s.delete(tileKey(id));
  }).catch(() => undefined);
}

/** sha256 of the data URL in hex: how the API tells one picture from another. */
export async function fingerprint(dataUrl: string): Promise<string> {
  const sum = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataUrl));
  return [...new Uint8Array(sum)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Draws the picture at most `edge` px on its long side and encodes it. */
async function draw(source: Blob, edge: number, mime: string, quality: number): Promise<string> {
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL(mime, quality);
}

/** Downscale to <= 2048px on the long edge and encode as JPEG (or keep PNG for transparency). */
export const preparePicture = (file: File) =>
  draw(file, 2048, file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.86);

/** The picker's tiles are about 130px wide; 400px stays sharp on a 3x screen. */
export async function tileOf(picture: Blob | string): Promise<string> {
  const blob = typeof picture === 'string' ? await (await fetch(picture)).blob() : picture;
  return draw(blob, 400, 'image/jpeg', 0.8);
}

/**
 * Files a picture in this browser and records it with the API at the price shown. When it is
 * already one of theirs (the same picture), it is filed under that one instead. The id it
 * ended up under.
 */
export async function addPicture(dataUrl: string, tile: string, cost: number): Promise<string> {
  const id = crypto.randomUUID();
  const hash = await fingerprint(dataUrl);
  // Filed first, so a recorded background is never without its picture here.
  await keepPicture(id, dataUrl, tile);
  try {
    const { background } = await api.addCustomBackground({ id, hash, cost });
    if (background.id !== id) {
      await keepPicture(background.id, dataUrl, tile);
      await dropPicture(id);
    }
    return background.id;
  } catch (err) {
    await dropPicture(id);
    throw err;
  }
}

/** The real price when the API refused the one sent (a 409), else null. */
export function priceOf(err: unknown): number | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const cost = (err.body as { details?: { cost?: unknown } } | null)?.details?.cost;
  return typeof cost === 'number' ? cost : null;
}

let adopting: Promise<string | null> | null = null;

/**
 * Moves a background uploaded before they were kept here out of the API and into this
 * browser. The picture, or null when the API has none. The API deletes its copy only after
 * this browser has filed it.
 */
export function adoptServerCopy(): Promise<string | null> {
  adopting ??= (async () => {
    try {
      const { background, dataUrl } = await api.adoptBackground(crypto.randomUUID());
      await keepPicture(background.id, dataUrl, await tileOf(dataUrl));
      await api.adoptedBackground();
      return dataUrl;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    } finally {
      adopting = null;
    }
  })();
  return adopting;
}
