/**
 * Fonts people can pick for the timer, headings and text (Settings › Appearance › Fonts).
 * Each is free (SIL Open Font License) and bundled by the portal, which loads one only when it
 * is used. 'default' is Inter, the app's own. A font someone uploads is `upload:<id>`, kept
 * in the browser it was added in.
 */

export type FontKind = 'sans' | 'serif' | 'mono' | 'display';

export interface FreeFont {
  id: string;
  name: string;
  kind: FontKind;
}

export const DEFAULT_FONT = 'default';
export const UPLOADED_FONT_PREFIX = 'upload:';

export const FREE_FONTS: readonly FreeFont[] = [
  { id: 'dm-sans', name: 'DM Sans', kind: 'sans' },
  { id: 'manrope', name: 'Manrope', kind: 'sans' },
  { id: 'outfit', name: 'Outfit', kind: 'sans' },
  { id: 'nunito', name: 'Nunito', kind: 'sans' },
  { id: 'lexend', name: 'Lexend', kind: 'sans' },
  { id: 'atkinson', name: 'Atkinson Hyperlegible', kind: 'sans' },
  { id: 'space-grotesk', name: 'Space Grotesk', kind: 'sans' },
  { id: 'lora', name: 'Lora', kind: 'serif' },
  { id: 'fraunces', name: 'Fraunces', kind: 'serif' },
  { id: 'source-serif', name: 'Source Serif', kind: 'serif' },
  { id: 'playfair', name: 'Playfair Display', kind: 'serif' },
  { id: 'roboto-mono', name: 'Roboto Mono', kind: 'mono' },
  { id: 'fira-code', name: 'Fira Code', kind: 'mono' },
  { id: 'space-mono', name: 'Space Mono', kind: 'mono' },
  { id: 'bebas-neue', name: 'Bebas Neue', kind: 'display' },
  { id: 'orbitron', name: 'Orbitron', kind: 'display' },
  { id: 'caveat', name: 'Caveat', kind: 'display' },
];

const UPLOADED = /^upload:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The id of their own font in a choice, or null when the choice is one of the app's. */
export function uploadedFontId(choice: string): string | null {
  return UPLOADED.test(choice) ? choice.slice(UPLOADED_FONT_PREFIX.length) : null;
}

/** Default, one of the free fonts, or one of their own. */
export function isFontChoice(choice: unknown): choice is string {
  if (typeof choice !== 'string') return false;
  return (
    choice === DEFAULT_FONT || UPLOADED.test(choice) || FREE_FONTS.some((f) => f.id === choice)
  );
}

/** A choice read back from storage: anything unknown (a font since removed) is the default. */
export function fontChoiceOf(choice: unknown): string {
  return isFontChoice(choice) ? choice : DEFAULT_FONT;
}
