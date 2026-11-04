import { DEFAULT_FONT, uploadedFontId, type UserSettings } from '@komogon/core';
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

/**
 * The timer, heading and text fonts from Settings › Appearance › Fonts, the same files as
 * the portal's `lib/fonts.ts`. A font someone uploaded lives in the app's own browser
 * storage; the app hands the ones in use to the extension (`ownFonts`), and until one
 * arrives, or for one too big to hand over, Inter stands in.
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

const FALLBACK = `'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`;

const VARS: Record<FontKey, string> = {
  fontText: '--font-sans',
  fontHeading: '--font-display',
  fontTimer: '--font-timer',
};

const loaded = new Map<string, Promise<boolean>>();

const familyOf = (choice: string) => {
  const own = uploadedFontId(choice);
  return own ? `kf-own-${own}` : `kf-${choice}`;
};

function fromBase64(data: string): ArrayBuffer {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function loadFont(choice: string, own: Record<string, string>): Promise<boolean> {
  const ownId = uploadedFontId(choice);
  const files = FILES[choice];
  if (ownId ? !own[ownId] : !files) return Promise.resolve(false);
  let p = loaded.get(choice);
  if (!p) {
    const faces = ownId
      ? [
          new FontFace(familyOf(choice), fromBase64(own[ownId]!), {
            weight: EVERY_WEIGHT,
            display: 'swap',
          }),
        ]
      : files!.map(
          (f) =>
            new FontFace(familyOf(choice), `url(${f.url}) format('woff2')`, {
              weight: f.weight,
              display: 'swap',
            }),
        );
    p = Promise.all(faces.map((f) => f.load()))
      .then(() => {
        for (const f of faces) document.fonts.add(f);
        return true;
      })
      .catch(() => false);
    loaded.set(choice, p);
    // A miss is tried again next time (their own font may arrive from the app later).
    void p.then((ok) => {
      if (!ok) loaded.delete(choice);
    });
  }
  return p;
}

const applied: Partial<Record<FontKey, string>> = {};

/** Puts the chosen fonts on <html> as they load; the app's own until then. */
export function applyFonts(
  theme: Pick<UserSettings['theme'], FontKey>,
  root: HTMLElement,
  own: Record<string, string>,
) {
  for (const key of Object.keys(VARS) as FontKey[]) {
    const choice = theme[key] ?? DEFAULT_FONT;
    // Their own font that has only just arrived is tried again.
    const ownId = uploadedFontId(choice);
    const tag = ownId && own[ownId] ? `${choice}+` : choice;
    if (applied[key] === tag) continue;
    applied[key] = tag;
    const clear = () => {
      root.style.removeProperty(VARS[key]);
      if (key === 'fontTimer') delete root.dataset.timerFont;
    };
    if (choice === DEFAULT_FONT) {
      clear();
      continue;
    }
    void loadFont(choice, own).then((ok) => {
      if (applied[key] !== tag) return;
      if (!ok) return clear();
      root.style.setProperty(VARS[key], `'${familyOf(choice)}', ${FALLBACK}`);
      if (key === 'fontTimer') root.dataset.timerFont = '';
    });
  }
}
