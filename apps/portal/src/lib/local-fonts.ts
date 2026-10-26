/**
 * Fonts people upload, kept in this browser only, like their own backgrounds
 * (`local-backgrounds.ts`): IndexedDB, keyed by the font's id, with the account it was added
 * on. The setting says `upload:<id>`; another browser doesn't have the file and shows the
 * default font instead.
 */

const DB_NAME = 'komogon-fonts';
const STORE = 'fonts';

/** Big enough for a font with a whole CJK set; anything larger isn't kept. */
export const MAX_FONT_BYTES = 20 * 1024 * 1024;

export interface LocalFontInfo {
  id: string;
  name: string;
  added: number;
}

interface LocalFont extends LocalFontInfo {
  /** The account it was added on. */
  owner: string;
  data: ArrayBuffer;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
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
    tx.onabort = () => reject(tx.error ?? new Error('This browser would not keep the font'));
  });
}

/** Their fonts in this browser, oldest first, without the files. */
export async function localFonts(owner: string): Promise<LocalFontInfo[]> {
  try {
    const all = await run<LocalFont[]>('readonly', (s) => s.getAll());
    return all
      .filter((f) => f.owner === owner)
      .sort((a, b) => a.added - b.added)
      .map(({ id, name, added }) => ({ id, name, added }));
  } catch {
    return [];
  }
}

/** The font's file, or null when it isn't in this browser. */
export async function localFontFile(id: string): Promise<ArrayBuffer | null> {
  try {
    return (await run<LocalFont | undefined>('readonly', (s) => s.get(id)))?.data ?? null;
  } catch {
    return null;
  }
}

/** "My-Font_Bold.woff2" reads "My Font Bold". */
export function fontNameOf(fileName: string): string {
  const bare = fileName.replace(/\.(ttf|otf|woff2?)$/i, '');
  const name = bare.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (name || 'My font').slice(0, 60);
}

/** Files the font in this browser; the id it is kept under. */
export async function keepFont(owner: string, name: string, data: ArrayBuffer): Promise<string> {
  const id = crypto.randomUUID();
  const font: LocalFont = { id, owner, name, data, added: Date.now() };
  await run('readwrite', (s) => {
    s.put(font);
  });
  return id;
}

export async function dropFont(id: string): Promise<void> {
  await run('readwrite', (s) => {
    s.delete(id);
  }).catch(() => undefined);
}
