import { DEFAULT_SETTINGS } from './defaults';
import { BACKGROUNDS, solidColorOf } from './economy';
import type { UserSettings } from './types';

/**
 * Preset themes (Settings › Appearance › Themes): a whole look in one click. Each sets the
 * accent, background, panels, glass and texture together; only a look made for one mode (the
 * flat colours) sets light or dark, and the rest keep the mode already chosen. Dawn Skies is
 * exactly the default an account starts on, so it is always the one that matches a new
 * account. Every background here is a free one, so a preset never meets a locked background.
 */

type Theme = UserSettings['theme'];

export type ThemeTag = 'minimalist' | 'nature' | 'cities' | 'night' | 'abstract';

/** Display order and labels for the tag filter. */
export const THEME_TAGS: Array<{ id: ThemeTag; label: string }> = [
  { id: 'minimalist', label: 'Minimalist' },
  { id: 'nature', label: 'Nature' },
  { id: 'cities', label: 'Cities' },
  { id: 'night', label: 'Night' },
  { id: 'abstract', label: 'Abstract' },
];

/** What a preset sets. Panel colour and opacity only matter to a custom panel. */
export type ThemeLook = Pick<
  Theme,
  | 'accent'
  | 'backgroundId'
  | 'panel'
  | 'glassColor'
  | 'glassAlpha'
  | 'glassBlur'
  | 'glassSaturate'
  | 'texture'
> & {
  /**
   * Light or dark, only on a look made for one (the flat colours). The others keep the mode
   * already chosen (owner, 2026-10-23: the background never picks the mode).
   */
  mode?: Theme['mode'];
};

export interface ThemePreset {
  /** Stable: kept nowhere yet, but treat it like a background id. */
  id: string;
  name: string;
  tag: ThemeTag;
  look: ThemeLook;
}

const DEFAULT_GLASS = {
  glassColor: DEFAULT_SETTINGS.theme.glassColor,
  glassAlpha: DEFAULT_SETTINGS.theme.glassAlpha,
  glassBlur: DEFAULT_SETTINGS.theme.glassBlur,
  glassSaturate: DEFAULT_SETTINGS.theme.glassSaturate,
};

/** A photo with the default glass, light or dark picked from the photo. */
function photo(
  id: string,
  name: string,
  tag: ThemeTag,
  backgroundId: string,
  accent: string,
): ThemePreset {
  return {
    id,
    name,
    tag,
    look: {
      accent,
      backgroundId,
      panel: 'glass',
      ...DEFAULT_GLASS,
      texture: 'none',
    },
  };
}

/**
 * A flat colour with matte panels. Matte over a solid colour takes its cards, bars and
 * dialogs from that colour (see `tonalSurfaces` in the ui package), which is most of what
 * makes these look finished rather than like a blank page.
 */
function solid(
  id: string,
  name: string,
  hex: string,
  mode: 'light' | 'dark',
  accent: string,
  texture: Theme['texture'],
): ThemePreset {
  return {
    id,
    name,
    tag: 'minimalist',
    look: {
      mode,
      accent,
      backgroundId: `solid:${hex}`,
      panel: 'matte',
      ...DEFAULT_GLASS,
      texture,
    },
  };
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'dawn-skies',
    name: 'Dawn Skies',
    tag: 'nature',
    look: {
      accent: DEFAULT_SETTINGS.theme.accent,
      backgroundId: DEFAULT_SETTINGS.theme.backgroundId,
      panel: DEFAULT_SETTINGS.theme.panel,
      ...DEFAULT_GLASS,
      texture: DEFAULT_SETTINGS.theme.texture,
    },
  },
  solid('linen', 'Linen', '#e7e6e3', 'light', 'custom:232,24,30', 'none'),
  solid('deep-sea', 'Deep Sea', '#323652', 'dark', 'custom:165,34,46', 'none'),
  solid('off-white', 'Off White', '#f4f1ea', 'light', DEFAULT_SETTINGS.theme.accent, 'grain'),
  solid('night-shift', 'Night Shift', '#313338', 'dark', 'custom:235,86,65', 'none'),
  solid('inkwell', 'Inkwell', '#1c1c21', 'dark', 'custom:29,100,71', 'none'),
  {
    id: 'quiet-stone',
    name: 'Quiet Stone',
    tag: 'minimalist',
    look: {
      accent: 'sky',
      backgroundId: 'graphite',
      panel: 'matte',
      ...DEFAULT_GLASS,
      texture: 'grain',
    },
  },
  photo('cherry-peak', 'Cherry Peak', 'nature', 'fuji', 'rose'),
  photo('deep-woods', 'Deep Woods', 'nature', 'pine-ridge', 'mint'),
  {
    id: 'last-light',
    name: 'Last Light',
    tag: 'nature',
    look: {
      accent: 'custom:29,100,71',
      backgroundId: 'valley-light',
      panel: 'matte',
      ...DEFAULT_GLASS,
      texture: 'none',
    },
  },
  photo('harbour-glow', 'Harbour Glow', 'cities', 'harbour-lights', 'sky'),
  photo('old-town', 'Old Town', 'cities', 'rooftops', 'custom:309,29,70'),
  photo('paper-lanterns', 'Paper Lanterns', 'cities', 'lanterns', 'custom:32,6,52'),
  photo('clear-night', 'Clear Night', 'night', 'star-field', 'violet'),
  photo('desert-night', 'Desert Night', 'night', 'canyon-stars', 'sky'),
  photo('plum-velvet', 'Plum Velvet', 'abstract', 'velvet', 'violet'),
  photo('still-water', 'Still Water', 'abstract', 'lagoon', 'mint'),
  // The owner's palettes (2026-10-25), at the end of the list. Salt Air and Gold Leaf are
  // also setup's Minimalist look.
  solid('dusk-rose', 'Dusk Rose', '#1c263f', 'dark', 'custom:318,24,66', 'none'),
  solid('salt-air', 'Salt Air', '#c8d8e4', 'light', 'custom:193,47,32', 'none'),
  solid('wisteria', 'Wisteria', '#f3eef8', 'light', 'custom:266,20,44', 'none'),
  solid('tidepool', 'Tidepool', '#152c2d', 'dark', 'custom:183,44,40', 'none'),
  solid('gold-leaf', 'Gold Leaf', '#020b13', 'dark', 'custom:44,70,52', 'none'),
];

/**
 * Flat colours that came with their own text colour (the owner's palettes, 2026-10-25: Linen's
 * #33322e, white on Deep Sea, Dusk Rose's pale pink, Wisteria's deep violet). Matte panels on
 * one use it for the main text wherever it reads (`tonalSurfaces` in the ui package); the
 * quieter text is still worked out from the colour.
 */
export const SOLID_TEXT: Record<string, string> = {
  '#e7e6e3': '#33322e',
  '#323652': '#ffffff',
  '#1c263f': '#e4d3db',
  '#f3eef8': '#2a2550',
};

/** A solid colour or one of the Minimal gradients: the backgrounds a texture shows on. */
export function isPlainBackground(id: string): boolean {
  return !!solidColorOf(id) || BACKGROUNDS.find((b) => b.id === id)?.category === 'minimal';
}

/** The settings patch that puts a preset on: its look, and no uploaded image over it. */
export function themePresetPatch(preset: ThemePreset): Partial<Theme> {
  return { ...preset.look, customBackgroundUrl: null };
}

/**
 * The preset the current look is, if any. Only what shows counts: the glass on a glass
 * panel, the texture on a plain background.
 */
export function matchingThemePreset(theme: Theme): ThemePreset | null {
  if (theme.customBackgroundUrl) return null;
  return (
    THEME_PRESETS.find(({ look }) => {
      if (
        (look.mode !== undefined && look.mode !== theme.mode) ||
        look.accent !== theme.accent ||
        look.backgroundId !== theme.backgroundId ||
        look.panel !== theme.panel
      )
        return false;
      if (
        look.panel === 'glass' &&
        (look.glassColor !== theme.glassColor ||
          look.glassAlpha !== theme.glassAlpha ||
          look.glassBlur !== theme.glassBlur ||
          look.glassSaturate !== theme.glassSaturate)
      )
        return false;
      return !isPlainBackground(look.backgroundId) || look.texture === (theme.texture ?? 'none');
    }) ?? null
  );
}
