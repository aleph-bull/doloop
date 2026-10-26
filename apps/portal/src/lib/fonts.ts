import { DEFAULT_FONT, FREE_FONTS, uploadedFontId, type UserSettings } from '@komogon/core';
import atkinson from '@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2?url';
import caveat from '@fontsource-variable/caveat/files/caveat-latin-wght-normal.woff2?url';
import dmSans from '@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2?url';
import firaCode from '@fontsource-variable/fira-code/files/fira-code-latin-wght-normal.woff2?url';
import fraunces from '@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2?url';
import lexend from '@fontsource-variable/lexend/files/lexend-latin-wght-normal.woff2?url';
import lora from '@fontsource-variable/lora/files/lora-latin-wght-normal.woff2?url';
import manrope from '@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2?url';
import nunito from '@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2?url';
import orbitron from '@fontsource-variable/orbitron/files/orbitron-latin-wght-normal.woff2?url';
import outfit from '@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2?url';
import playfair from '@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2?url';
import robotoMono from '@fontsource-variable/roboto-mono/files/roboto-mono-latin-wght-normal.woff2?url';
import sourceSerif from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2?url';
import spaceGrotesk from '@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2?url';
import bebasNeue from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2?url';
import spaceMono400 from '@fontsource/space-mono/files/space-mono-latin-400-normal.woff2?url';
import spaceMono700 from '@fontsource/space-mono/files/space-mono-latin-700-normal.woff2?url';
import { localFontFile } from './local-fonts';

/**
 * Fonts for the timer, headings and text (Settings › Appearance › Fonts). The free ones are
 * bundled (latin letters; anything else falls back to Inter a letter at a time) and each is
 * fetched only once it is picked or the picker shows it. Their own come out of IndexedDB.
 *
 * A face covers every weight, so a font with one weight is drawn as it is rather than
 * thickened into a made-up bold for headings.
 */

type FontKey = 'fontText' | 'fontHeading' | 'fontTimer';

const EVERY_WEIGHT = '1 1000';

const FILES: Record<string, { url: string; weight: string }[]> = {
  'dm-sans': [{ url: dmSans, weight: EVERY_WEIGHT }],
  manrope: [{ url: manrope, weight: EVERY_WEIGHT }],
  outfit: [{ url: outfit, weight: EVERY_WEIGHT }],
  nunito: [{ url: nunito, weight: EVERY_WEIGHT }],
  lexend: [{ url: lexend, weight: EVERY_WEIGHT }],
  atkinson: [{ url: atkinson, weight: EVERY_WEIGHT }],
  'space-grotesk': [{ url: spaceGrotesk, weight: EVERY_WEIGHT }],
  lora: [{ url: lora, weight: EVERY_WEIGHT }],
  fraunces: [{ url: fraunces, weight: EVERY_WEIGHT }],
  'source-serif': [{ url: sourceSerif, weight: EVERY_WEIGHT }],
  playfair: [{ url: playfair, weight: EVERY_WEIGHT }],
  'roboto-mono': [{ url: robotoMono, weight: EVERY_WEIGHT }],
  'fira-code': [{ url: firaCode, weight: EVERY_WEIGHT }],
  'space-mono': [
    { url: spaceMono400, weight: '1 550' },
    { url: spaceMono700, weight: '551 1000' },
  ],
  'bebas-neue': [{ url: bebasNeue, weight: EVERY_WEIGHT }],
  orbitron: [{ url: orbitron, weight: EVERY_WEIGHT }],
  caveat: [{ url: caveat, weight: EVERY_WEIGHT }],
};

/** Behind every chosen font: Inter, then the system's. */
const FALLBACK = `'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`;

/** The CSS variable each setting sets on <html>. */
const VARS: Record<FontKey, string> = {
  fontText: '--font-sans',
  fontHeading: '--font-display',
  fontTimer: '--font-timer',
};

const familyName = (choice: string) => {
  const own = uploadedFontId(choice);
  return own ? `kf-own-${own}` : `kf-${choice}`;
};

/** The font-family for a choice, to draw a name in its own font. */
export function fontStack(choice: string): string {
  return choice === DEFAULT_FONT ? FALLBACK : `'${familyName(choice)}', ${FALLBACK}`;
}

const loaded = new Map<string, Promise<boolean>>();
const faces = new Map<string, FontFace[]>();

async function load(choice: string): Promise<boolean> {
  const family = familyName(choice);
  const own = uploadedFontId(choice);
  let made: FontFace[];
  if (own) {
    const file = await localFontFile(own);
    if (!file) return false;
    made = [new FontFace(family, file, { weight: EVERY_WEIGHT, display: 'swap' })];
  } else {
    const files = FILES[choice];
    if (!files) return false;
    made = files.map(
      (f) =>
        new FontFace(family, `url(${f.url}) format('woff2')`, {
          weight: f.weight,
          display: 'swap',
        }),
    );
  }
  await Promise.all(made.map((f) => f.load()));
  for (const f of made) document.fonts.add(f);
  faces.set(choice, made);
  return true;
}

/**
 * Loads a font once. False for the default, a font that isn't in this browser, or one that
 * won't load; then the default is used.
 */
export function loadFont(choice: string): Promise<boolean> {
  if (choice === DEFAULT_FONT) return Promise.resolve(false);
  let p = loaded.get(choice);
  if (!p) {
    p = load(choice).catch(() => false);
    loaded.set(choice, p);
    // A miss is tried again next time (back online, or the file came back).
    void p.then((ok) => {
      if (!ok) loaded.delete(choice);
    });
  }
  return p;
}

/** Every free font, for the picker to show each name in its own font. */
export function loadFreeFonts(): void {
  for (const f of FREE_FONTS) void loadFont(f.id);
}

/** Takes a deleted font of their own off the page. */
export function forgetFont(choice: string): void {
  for (const f of faces.get(choice) ?? []) document.fonts.delete(f);
  faces.delete(choice);
  loaded.delete(choice);
}

/** Checks a file is a font the browser can draw before it is kept. */
export async function readableFont(data: ArrayBuffer): Promise<boolean> {
  try {
    await new FontFace('kf-check', data).load();
    return true;
  } catch {
    return false;
  }
}

/** What is on <html> for each setting, so a font that finishes loading late can't undo a newer pick. */
const applied: Partial<Record<FontKey, string>> = {};

/**
 * Puts the chosen fonts on <html> as they load; until then, and for the default or a font
 * not in this browser, the app's own. `data-timer-font` turns on even digit widths for a
 * timer font whose figures aren't all one width.
 */
export function applyFonts(theme: Pick<UserSettings['theme'], FontKey>, root: HTMLElement) {
  for (const key of Object.keys(VARS) as FontKey[]) {
    const choice = theme[key] ?? DEFAULT_FONT;
    if (applied[key] === choice) continue;
    applied[key] = choice;
    const clear = () => {
      root.style.removeProperty(VARS[key]);
      if (key === 'fontTimer') delete root.dataset.timerFont;
    };
    if (choice === DEFAULT_FONT) {
      clear();
      continue;
    }
    void loadFont(choice).then((ok) => {
      if (applied[key] !== choice) return;
      if (!ok) return clear();
      root.style.setProperty(VARS[key], fontStack(choice));
      if (key === 'fontTimer') root.dataset.timerFont = '';
    });
  }
}
