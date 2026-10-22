import type { UserSettings } from '@komogon/core';

/**
 * Appearance presets: named snapshots of the background, accent and panel style, kept in
 * this browser only. The list lives in localStorage; an uploaded background's image, too
 * big for it, lives in IndexedDB under the preset's id. Nothing here is sent to the API.
 */

type Theme = UserSettings['theme'];

export interface AppearancePreset {
  id: string;
  name: string;
  createdAt: string;
  accent: string;
  /** A preset or solid-colour id; ignored when `hasImage` is set. */
  backgroundId: string;
  /** True when the preset's background is an uploaded image, kept in IndexedDB. */
  hasImage: boolean;
  panel: Theme['panel'];
  panelColor: string;
  panelAlpha: number;
  /** The glass (Appearance › Advanced). Missing on looks saved before it existed. */
  glassColor?: string | null;
  glassAlpha?: number | null;
  glassBlur?: number;
  glassSaturate?: number;
}

const LIST_KEY = 'komogon.appearancePresets';
const DB_NAME = 'komogon-presets';
const STORE = 'images';

export const MAX_PRESETS = 12;

export function loadPresets(): AppearancePreset[] {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    const list = raw ? (JSON.parse(raw) as AppearancePreset[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveList(list: AppearancePreset[]): void {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
  } catch {
    throw new Error('This browser would not save the preset. Is storage turned off?');
  }
}

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open local storage'));
  });
}

async function idb<T>(
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = run(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error('Local storage failed'));
    tx.oncomplete = () => d.close();
  });
}

/** The uploaded image a preset keeps, as a data URL, or null if it is gone from this browser. */
export async function presetImage(id: string): Promise<string | null> {
  try {
    return (await idb<string | undefined>('readonly', (s) => s.get(id))) ?? null;
  } catch {
    return null;
  }
}

/** Save the current look as a new preset. `image` is the uploaded background, if one is in use. */
export async function savePreset(
  name: string,
  theme: Theme,
  image: string | null,
): Promise<AppearancePreset> {
  const list = loadPresets();
  if (list.length >= MAX_PRESETS)
    throw new Error(`You can keep up to ${MAX_PRESETS} presets. Delete one first.`);
  const preset: AppearancePreset = {
    id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim().slice(0, 40) || 'My look',
    createdAt: new Date().toISOString(),
    accent: theme.accent,
    backgroundId: theme.backgroundId,
    hasImage: !!theme.customBackgroundUrl && !!image,
    panel: theme.panel,
    panelColor: theme.panelColor,
    panelAlpha: theme.panelAlpha,
    glassColor: theme.glassColor,
    glassAlpha: theme.glassAlpha,
    glassBlur: theme.glassBlur,
    glassSaturate: theme.glassSaturate,
  };
  if (preset.hasImage) await idb('readwrite', (s) => s.put(image, preset.id));
  saveList([...list, preset]);
  return preset;
}

export function renamePreset(id: string, name: string): AppearancePreset[] {
  const list = loadPresets().map((p) =>
    p.id === id ? { ...p, name: name.trim().slice(0, 40) || p.name } : p,
  );
  saveList(list);
  return list;
}

export async function deletePreset(id: string): Promise<AppearancePreset[]> {
  const list = loadPresets().filter((p) => p.id !== id);
  saveList(list);
  await idb('readwrite', (s) => s.delete(id)).catch(() => undefined);
  return list;
}
