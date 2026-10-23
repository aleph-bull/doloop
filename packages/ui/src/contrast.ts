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

/** The wash each theme lays over a photograph (kept in step with backgrounds.ts `scrim`). */
export const PHOTO_SCRIM: Record<'light' | 'dark', { color: RGB; alpha: number }> = {
  light: { color: [255, 255, 255], alpha: 0.24 },
  dark: { color: [6, 7, 10], alpha: 0.42 },
};

/**
 * Each theme's own glass, in step with tokens.css: the text on it, its tint, and the
 * opacities it never goes below.
 */
export const THEME_GLASS: Record<
  'light' | 'dark',
  { fg: RGB; fill: RGB; alpha: number; strongAlpha: number; chrome: RGB; chromeAlpha: number }
> = {
  light: {
    fg: [15, 18, 32],
    fill: [255, 255, 255],
    alpha: 0.6,
    strongAlpha: 0.78,
    chrome: [255, 255, 255],
    chromeAlpha: 0.58,
  },
  dark: {
    fg: [244, 245, 249],
    fill: [22, 24, 36],
    alpha: 0.5,
    strongAlpha: 0.7,
    chrome: [30, 32, 44],
    chromeAlpha: 0.5,
  },
};

const TEXT_LIGHT: RGB = [242, 243, 248];
const TEXT_DARK: RGB = [15, 18, 32];

export interface PhotoAdaptation extends GlassAdaptation {
  /** Chrome (nav, tab bar) opacity: thinner than the cards, never below the theme's own. */
  chromeAlpha: number;
  /**
   * Text that sits straight on the backdrop (page titles, headings): the mode's own, white
   * in dark mode and black in light, whatever the photo.
   */
  pageFg: RGB;
  /** Tint of the page wash and the halo behind that text: the opposite of `pageFg`. */
  pageWash: RGB;
  /** How much of `pageWash` is laid over the whole photo so `pageFg` clears 4.5:1. */
  pageScrim: number;
}

/** Which text a backdrop colour wants straight on it, as it is shown under a theme's scrim. */
function readsLight(shown: RGB): boolean {
  return contrastRatio(TEXT_LIGHT, shown) >= contrastRatio(TEXT_DARK, shown);
}

/** The most of the wash laid over a photo, darkening it in dark mode or lightening it in light. */
const MAX_PAGE_SCRIM = 0.9;

/**
 * Glass and page text for a photograph in a theme.
 *
 * Everything keeps the theme's own look: panels keep its text and tint, and text straight
 * on the backdrop is white in dark mode and black in light, on any photo (owner, 2026-10-23:
 * a light photo no longer turns the page's text dark). A busy photo can only make the glass
 * thicker, until the quietest text on it clears 4.5:1, and the photo itself is darkened (or
 * lightened, in light mode) until the page's text clears 4.5:1 on it. A flat colour
 * (`washes` false: the Backdrop lays no wash over one, since that would change the colour
 * chosen) keeps whichever of black or white reads on it.
 */
export function adaptToPhoto(avg: RGB, theme: 'light' | 'dark', washes = true): PhotoAdaptation {
  const scrim = PHOTO_SCRIM[theme];
  const shown = composite(scrim.color, scrim.alpha, avg);
  const own = THEME_GLASS[theme];
  const fg = own.fg;
  const fill = own.fill;
  // Thick enough that the quietest text on glass (the text colour at 64%, tokens.css
  // --fg-on-glass-subtle) still clears 4.5:1, not just the primary text.
  const subtleOn = (alpha: number) => {
    const glass = composite(fill, alpha, shown);
    return contrastRatio(composite(fg, 0.64, glass), glass);
  };
  let alpha = own.alpha;
  while (subtleOn(alpha) < 4.5 && alpha < MAX_ALPHA) {
    alpha = Math.round((alpha + 0.05) * 100) / 100;
  }
  const ratio = contrastRatio(fg, composite(fill, alpha, shown));

  const lightText = washes ? theme === 'dark' : readsLight(shown);
  const pageFg = lightText ? TEXT_LIGHT : TEXT_DARK;
  const pageWash: RGB = lightText ? [20, 22, 36] : [255, 255, 255];
  let pageScrim = 0;
  while (
    contrastRatio(pageFg, composite(pageWash, pageScrim, shown)) < 4.5 &&
    pageScrim < MAX_PAGE_SCRIM
  ) {
    pageScrim = Math.round((pageScrim + 0.05) * 100) / 100;
  }
  return {
    fg,
    fill,
    alpha,
    strongAlpha: Math.min(0.97, Math.max(own.strongAlpha, Math.round((alpha + 0.15) * 100) / 100)),
    chromeAlpha: Math.max(own.chromeAlpha, Math.round((alpha - 0.05) * 100) / 100),
    ratio,
    pageFg,
    pageWash,
    pageScrim,
  };
}

/** The glass someone set in Settings › Appearance › Advanced. Null keeps the theme's own. */
export interface GlassChoice {
  color: string | null;
  alpha: number | null;
}

export interface ChosenGlass {
  fill: RGB;
  alpha: number;
  strongAlpha: number;
  /** The top bar and sidebar take a chosen colour too, since they share the text colour. */
  chrome: RGB;
  /** Whichever of light or dark text reads better on the cards as they show. */
  lightText: boolean;
}

/**
 * The glass with someone's own colour and weight, over `avg` (a photo or flat colour, shown
 * under its scrim) or the theme's plain base on a gradient. `own` is the glass it replaces,
 * so a colour alone keeps the weight the photo asked for. Null when nothing is chosen.
 * Their weight is kept as set, even where the theme's own glass would have been thicker.
 */
export function chooseGlass(
  choice: GlassChoice,
  theme: 'light' | 'dark',
  avg: RGB | null,
  own: { alpha: number; strongAlpha: number },
): ChosenGlass | null {
  if (!choice.color && choice.alpha === null) return null;
  const base = THEME_GLASS[theme];
  const color = choice.color && /^#[0-9a-f]{6}$/i.test(choice.color) ? choice.color : null;
  const fill = color ? hexToRgb(color) : base.fill;
  const alpha =
    choice.alpha === null ? own.alpha : Math.min(MAX_ALPHA, Math.max(0.3, choice.alpha));
  const strongAlpha = Math.min(
    0.97,
    Math.max(own.strongAlpha, Math.round((alpha + 0.15) * 100) / 100),
  );
  const behind: RGB = avg
    ? composite(PHOTO_SCRIM[theme].color, PHOTO_SCRIM[theme].alpha, avg)
    : theme === 'dark'
      ? [11, 13, 20]
      : [238, 240, 245];
  const card = composite(fill, alpha, behind);
  const lightText = color
    ? contrastRatio(TEXT_LIGHT, card) >= contrastRatio(TEXT_DARK, card)
    : theme === 'dark';
  return { fill, alpha, strongAlpha, chrome: color ? fill : base.chrome, lightText };
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

/** The surfaces and text a solid colour gives matte panels (see `tonalSurfaces`). */
export interface TonalSurfaces {
  /** The colour itself, the page. */
  bg: RGB;
  /** Cards, the top bar or sidebar, and dialogs. */
  card: RGB;
  /** Things lifted off a card: menus, popovers. */
  raised: RGB;
  /** Wells set into a card. */
  sunken: RGB;
  /** Text on cards. */
  ink: RGB;
  inkMuted: RGB;
  inkSubtle: RGB;
  /** Text straight on the colour. */
  page: RGB;
  pageMuted: RGB;
  pageSubtle: RGB;
  /** Light text on the cards (the dark theme), else dark. */
  lightText: boolean;
}

const clampPct = (v: number) => Math.max(0, Math.min(100, v));

/** hsl(h, s, l), moving l by `step` until `against` reads on it (or it on `against`) at `ratio`. */
function shadeUntil(
  h: number,
  s: number,
  l: number,
  step: number,
  against: RGB,
  ratio: number,
): { rgb: RGB; l: number } {
  let lig = clampPct(l);
  while (contrastRatio(hslToRgb(h, s, lig), against) < ratio && lig > 0 && lig < 100)
    lig = clampPct(lig + step);
  return { rgb: hslToRgb(h, s, lig), l: lig };
}

/**
 * Matte panels over a solid colour: every surface a shade of that colour, and the text
 * tinted with its hue, rather than the theme's own blue-greys on top of it. A dark colour
 * gets cards a step lighter, a light one cards a step whiter (paper), and
 * a bright colour under the dark theme cards deep enough for light text. Every text colour
 * is moved only as far as it takes to clear its ratio: 7:1 for the main text, 6:1 for
 * muted, 4.6:1 for the quietest.
 */
export function tonalSurfaces(bg: RGB, theme: 'light' | 'dark'): TonalSurfaces {
  const [h, s, l] = rgbToHsl(bg);
  const lightText = theme === 'dark';
  // Cards keep the hue but not a bright colour's full strength, so they read as surfaces.
  const cs = Math.min(s, lightText ? 40 : 30);
  const inkS = Math.min(s, lightText ? 12 : 25);
  // Quieter text is greyer too, or a warm colour turns it olive.
  const quietS = Math.round(inkS * 0.6);
  const card = lightText
    ? shadeUntil(h, cs, l <= 30 ? l + 4 : l - 10, -1, TEXT_LIGHT, 7)
    : shadeUntil(h, cs, l >= 70 ? l + (100 - l) * 0.6 : l + 10, 1, TEXT_DARK, 7);
  const raised = hslToRgb(h, cs, clampPct(card.l + (lightText ? 4 : 2)));
  const sunken = hslToRgb(h, cs, clampPct(card.l - 3));
  const away = lightText ? 1 : -1;
  const ink = shadeUntil(h, inkS, lightText ? 95 : 11, away, card.rgb, 7).rgb;
  const inkMuted = shadeUntil(h, quietS, lightText ? 74 : 33, away, card.rgb, 6).rgb;
  const inkSubtle = shadeUntil(h, quietS, lightText ? 62 : 42, away, card.rgb, 4.6).rgb;
  // The page's own text follows the colour, whatever the theme: dark on a light colour.
  const pageLight = readsLight(bg);
  const pageAway = pageLight ? 1 : -1;
  const pageS = Math.min(s, pageLight ? 12 : 25);
  const page = shadeUntil(h, pageS, pageLight ? 96 : 11, pageAway, bg, 7).rgb;
  const pageMuted = shadeUntil(h, pageS, pageLight ? 80 : 30, pageAway, bg, 5).rgb;
  const pageSubtle = shadeUntil(h, pageS, pageLight ? 70 : 40, pageAway, bg, 4.6).rgb;
  return {
    bg,
    card: card.rgb,
    raised,
    sunken,
    ink,
    inkMuted,
    inkSubtle,
    page,
    pageMuted,
    pageSubtle,
    lightText,
  };
}
