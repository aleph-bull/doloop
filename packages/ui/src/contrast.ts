export type RGB = [number, number, number];

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0..1. */
export function relativeLuminance([r, g, b]: RGB): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two opaque colours, >= 1. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite `top` with alpha over an opaque `bottom`. */
export function composite(top: RGB, alpha: number, bottom: RGB): RGB {
  return top.map((c, i) => Math.round(c * alpha + bottom[i]! * (1 - alpha))) as RGB;
}

/** Light text on dark imagery, dark text on light imagery. */
export function luminanceToTextTheme(luminance: number): 'light' | 'dark' {
  return luminance < 0.4 ? 'light' : 'dark';
}

export interface GlassAdaptation {
  /** Text colour to use on glass over this backdrop. */
  fg: RGB;
  /** Tint of the glass fill: dark behind light text, light behind dark text. */
  fill: RGB;
  alpha: number;
  strongAlpha: number;
  /** Contrast actually achieved at `alpha`; below 4.5 the photo is simply too busy. */
  ratio: number;
}

const MAX_ALPHA = 0.95;

/**
 * Pick the text colour and glass opacity for an arbitrary backdrop colour.
 *
 * A photograph can be any colour, so the fill is thickened step by step until text on
 * glass clears 4.5:1. Used live for a user's uploaded image and ahead of time for every
 * shipped photo, so both go through identical maths.
 */
export function adaptGlassToBackdrop(avg: RGB): GlassAdaptation {
  const textTheme = luminanceToTextTheme(relativeLuminance(avg));
  const fg: RGB = textTheme === 'light' ? [242, 243, 248] : [15, 18, 32];
  const fill: RGB = textTheme === 'light' ? [20, 22, 36] : [255, 255, 255];
  let alpha = 0.45;
  let ratio = contrastRatio(fg, composite(fill, alpha, avg));
  while (ratio < 4.5 && alpha < MAX_ALPHA) {
    alpha = Math.round((alpha + 0.05) * 100) / 100;
    ratio = contrastRatio(fg, composite(fill, alpha, avg));
  }
  return {
    fg,
    fill,
    alpha,
    strongAlpha: Math.min(0.97, Math.round((alpha + 0.15) * 100) / 100),
    ratio,
  };
}

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** HSL (h 0-360, s/l 0-100) to RGB 0-255. */
export function hslToRgb(h: number, s: number, l: number): RGB {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

/** RGB 0-255 to HSL (h 0-360, s/l 0-100). */
export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const rr = r / 255,
    gg = g / 255,
    bb = b / 255;
  const max = Math.max(rr, gg, bb),
    min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
  else if (max === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)];
}
