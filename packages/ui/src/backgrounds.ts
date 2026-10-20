import { PHOTO_BACKGROUNDS } from './photos.generated';

/**
 * The background catalogue.
 *
 * Two kinds. **Gradients** are CSS-only and cost nothing to load: Graphite and its
 * siblings, all built to the same recipe — one soft light source over a quiet two-stop
 * base, no hue that competes with the accent. **Photographs** are shipped WebP files with
 * their average colour precomputed (see `scripts/prepare-backgrounds.ts`), which is what
 * lets the glass fill adapt without sampling anything in the browser.
 *
 * Ids are persisted in user settings, so they are stable and must not be renamed.
 */

export type BackgroundCategory =
  | 'minimal'
  | 'abstract'
  | 'sky'
  | 'mountains'
  | 'lakes'
  | 'night'
  | 'coast'
  | 'forest'
  | 'country'
  | 'desert'
  | 'cities'
  | 'lights';

/** Display order and labels for the grouped pickers. */
export const BACKGROUND_CATEGORIES: Array<{ id: BackgroundCategory; label: string }> = [
  { id: 'minimal', label: 'Minimal' },
  { id: 'abstract', label: 'Abstract' },
  { id: 'sky', label: 'Sky' },
  { id: 'mountains', label: 'Mountains' },
  { id: 'lakes', label: 'Lakes' },
  { id: 'night', label: 'Night' },
  { id: 'coast', label: 'Coast' },
  { id: 'forest', label: 'Forest' },
  { id: 'country', label: 'Open country' },
  { id: 'desert', label: 'Desert' },
  { id: 'cities', label: 'Cities' },
  { id: 'lights', label: 'Lights' },
];

export interface BackgroundVariant {
  /** CSS `background` shorthand value. */
  css: string;
  /** Approximate average luminance 0..1, used to pick text colour on glass. */
  luminance: number;
}

export interface BackgroundPhoto {
  /** Path relative to the app root. The extension prefixes it with the portal origin. */
  src: string;
  /** Average colour of the photograph, for the glass adaptation. */
  avg: [number, number, number];
  /** 640px preview for the pickers. Same path convention as `src`. */
  thumb: string;
  /** 20px placeholder, shown until the full image decodes. */
  lqip: string;
}

export interface BackgroundDef {
  id: string;
  name: string;
  category: BackgroundCategory;
  /** Present for photographs; absent for the CSS gradients. */
  photo?: BackgroundPhoto;
  /** Present for a solid colour the user picked: its RGB, for the glass adaptation. */
  solid?: [number, number, number];
  light: BackgroundVariant;
  dark: BackgroundVariant;
}

const glow = (x: string, y: string, color: string, size = '60%') =>
  `radial-gradient(${size} ${size} at ${x} ${y}, ${color}, transparent 70%)`;

/**
 * The Graphite family. One glow, one two-stop base, neutral hues only. The hue and the
 * position of the light source are the only things that change between them.
 */
function quiet(
  id: string,
  name: string,
  hue: number,
  sat: { light: number; dark: number },
  lightStops: [string, string],
  darkStops: [string, string],
  at: [string, string] = ['50%', '0%'],
  luminance: [number, number] = [0.85, 0.06],
): BackgroundDef {
  return {
    id,
    name,
    category: 'minimal',
    light: {
      css: [
        glow(at[0], at[1], `hsl(${hue} ${sat.light}% 92% / 1)`, '80%'),
        `linear-gradient(180deg, ${lightStops[0]} 0%, ${lightStops[1]} 100%)`,
      ].join(', '),
      luminance: luminance[0],
    },
    dark: {
      css: [
        glow(at[0], at[1], `hsl(${hue} ${sat.dark}% 22% / 1)`, '80%'),
        `linear-gradient(180deg, ${darkStops[0]} 0%, ${darkStops[1]} 100%)`,
      ].join(', '),
      luminance: luminance[1],
    },
  };
}

const GRADIENTS: BackgroundDef[] = [
  // The original, kept exactly as it was.
  quiet(
    'graphite',
    'Graphite',
    220,
    { light: 10, dark: 8 },
    ['#e9ebef', '#dfe2e8'],
    ['#111318', '#0a0b0f'],
  ),
  // Cooler and bluer.
  quiet(
    'slate',
    'Slate',
    212,
    { light: 16, dark: 14 },
    ['#e6eaf0', '#d8dee7'],
    ['#0f1319', '#080a0e'],
  ),
  // Warm grey, light from the upper left.
  quiet(
    'ash',
    'Ash',
    30,
    { light: 12, dark: 9 },
    ['#efece8', '#e4e0da'],
    ['#151310', '#0b0a08'],
    ['25%', '10%'],
  ),
  // The darkest of the set: a centred pool of light instead of a top wash.
  quiet(
    'onyx',
    'Onyx',
    220,
    { light: 6, dark: 6 },
    ['#eceded', '#e0e1e3'],
    ['#0b0b0d', '#050506'],
    ['50%', '45%'],
    [0.86, 0.04],
  ),
  // Faintly green, like wet stone.
  quiet(
    'basalt',
    'Basalt',
    160,
    { light: 10, dark: 8 },
    ['#e7ecea', '#dae2df'],
    ['#0e1211', '#070a09'],
    ['50%', '100%'],
  ),
  // The lightest: a low horizontal band rather than a glow.
  {
    id: 'fog',
    name: 'Fog',
    category: 'minimal',
    light: {
      css: [
        'linear-gradient(180deg, transparent 0 45%, hsl(215 18% 88% / 0.85) 75%, hsl(215 20% 84% / 0.9) 100%)',
        'linear-gradient(180deg, #f2f4f7 0%, #e7eaef 100%)',
      ].join(', '),
      luminance: 0.9,
    },
    dark: {
      css: [
        'linear-gradient(180deg, transparent 0 45%, hsl(215 14% 14% / 0.9) 75%, hsl(215 16% 17% / 1) 100%)',
        'linear-gradient(180deg, #0c0e12 0%, #101318 100%)',
      ].join(', '),
      luminance: 0.06,
    },
  },
];

/**
 * A photograph is the same image in both themes; only the scrim over it differs, and it
 * is kept light because the glass fill already adapts to the image's own colour. Its
 * average strength is PHOTO_SCRIM in contrast.ts, which the text colour is measured under.
 */
export const photoScrimCss = (theme: 'light' | 'dark'): string =>
  theme === 'dark'
    ? 'linear-gradient(180deg, rgb(6 7 10 / 0.35) 0%, rgb(6 7 10 / 0.5) 100%)'
    : 'linear-gradient(180deg, rgb(255 255 255 / 0.18) 0%, rgb(255 255 255 / 0.3) 100%)';

function photoDef(p: (typeof PHOTO_BACKGROUNDS)[number]): BackgroundDef {
  return {
    id: p.id,
    name: p.name,
    category: p.category as BackgroundCategory,
    photo: { src: p.src, thumb: p.thumb, avg: p.avg, lqip: p.lqip },
    // Used only as a fallback fill while the image loads, and by the contrast audit.
    light: { css: photoScrimCss('light'), luminance: 0.6 },
    dark: { css: photoScrimCss('dark'), luminance: 0.2 },
  };
}

export const BACKGROUND_DEFS: BackgroundDef[] = [...GRADIENTS, ...PHOTO_BACKGROUNDS.map(photoDef)];

/** The background an unknown id falls back to: the quiet one. New accounts start on Velvet. */
export const DEFAULT_BACKGROUND_ID = 'graphite';

/** A user's solid colour (`solid:#rrggbb`) as a flat background, or null for any other id. */
function solidDef(id: string): BackgroundDef | null {
  const m = /^solid:#([0-9a-f]{6})$/i.exec(id);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const rgb: [number, number, number] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const hex = `#${m[1]!.toLowerCase()}`;
  const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  const variant = { css: hex, luminance };
  return {
    id,
    name: 'Solid colour',
    category: 'minimal',
    solid: rgb,
    light: variant,
    dark: variant,
  };
}

export function backgroundById(id: string): BackgroundDef {
  const solid = solidDef(id);
  if (solid) return solid;
  return (
    BACKGROUND_DEFS.find((b) => b.id === id) ??
    BACKGROUND_DEFS.find((b) => b.id === DEFAULT_BACKGROUND_ID) ??
    BACKGROUND_DEFS[0]!
  );
}

export function backgroundsByCategory(): Array<{
  id: BackgroundCategory;
  label: string;
  items: BackgroundDef[];
}> {
  return BACKGROUND_CATEGORIES.map((c) => ({
    ...c,
    items: BACKGROUND_DEFS.filter((b) => b.category === c.id),
  })).filter((c) => c.items.length > 0);
}
