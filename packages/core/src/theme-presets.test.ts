import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './defaults';
import { isAccentUnlocked, isBackgroundAvailable, solidColorOf } from './economy';
import {
  isPlainBackground,
  matchingThemePreset,
  SOLID_TEXT,
  THEME_PRESETS,
  THEME_TAGS,
  themePresetPatch,
} from './theme-presets';

const theme = DEFAULT_SETTINGS.theme;

describe('theme presets', () => {
  it('Dawn Skies is the default look', () => {
    expect(matchingThemePreset(theme)?.name).toBe('Dawn Skies');
  });

  it('every preset can be put on by a new account', () => {
    for (const p of THEME_PRESETS) {
      expect(isBackgroundAvailable(p.look.backgroundId, 0, []), p.id).toBe(true);
      if (!p.look.accent.startsWith('custom:'))
        expect(isAccentUnlocked(p.look.accent, 0), p.id).toBe(true);
    }
  });

  it('has unique ids and a known tag on each', () => {
    const ids = THEME_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const tags = new Set(THEME_TAGS.map((t) => t.id));
    for (const p of THEME_PRESETS) expect(tags.has(p.tag), p.id).toBe(true);
  });

  it('the minimalist colours are matte solids', () => {
    for (const id of [
      'linen',
      'deep-sea',
      'off-white',
      'night-shift',
      'inkwell',
      'dusk-rose',
      'salt-air',
      'wisteria',
      'tidepool',
      'gold-leaf',
    ]) {
      const p = THEME_PRESETS.find((x) => x.id === id)!;
      expect(p.tag).toBe('minimalist');
      expect(p.look.panel).toBe('matte');
      expect(p.look.backgroundId).toMatch(/^solid:#[0-9a-f]{6}$/);
    }
  });

  it('gives text colours only to the flat colours of themes, in lowercase', () => {
    const solids = new Set(THEME_PRESETS.map((p) => solidColorOf(p.look.backgroundId)));
    for (const [hex, text] of Object.entries(SOLID_TEXT)) {
      expect(solids.has(hex), hex).toBe(true);
      expect(text).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('matches a preset once it is put on, and not after a change', () => {
    for (const p of THEME_PRESETS) {
      const on = { ...theme, ...themePresetPatch(p) };
      expect(matchingThemePreset(on)?.id).toBe(p.id);
      expect(matchingThemePreset({ ...on, accent: 'custom:1,2,3' })).toBeNull();
    }
  });

  it('keeps your light or dark on a photo, and sets it only on a flat colour', () => {
    const peak = THEME_PRESETS.find((p) => p.id === 'cherry-peak')!;
    expect(themePresetPatch(peak)).not.toHaveProperty('mode');
    expect(matchingThemePreset({ ...theme, ...themePresetPatch(peak), mode: 'dark' })?.id).toBe(
      'cherry-peak',
    );
    expect(matchingThemePreset({ ...theme, ...themePresetPatch(peak), mode: 'light' })?.id).toBe(
      'cherry-peak',
    );
    const inkwell = THEME_PRESETS.find((p) => p.id === 'inkwell')!;
    expect(themePresetPatch(inkwell).mode).toBe('dark');
    expect(
      matchingThemePreset({ ...theme, ...themePresetPatch(inkwell), mode: 'light' }),
    ).toBeNull();
  });

  it('ignores what does not show', () => {
    const peak = THEME_PRESETS.find((p) => p.id === 'cherry-peak')!;
    const on = { ...theme, ...themePresetPatch(peak) };
    // A texture never shows on a photo.
    expect(matchingThemePreset({ ...on, texture: 'dots' })?.id).toBe('cherry-peak');
    const inkwell = THEME_PRESETS.find((p) => p.id === 'inkwell')!;
    const matte = { ...theme, ...themePresetPatch(inkwell) };
    // Matte panels have no glass.
    expect(matchingThemePreset({ ...matte, glassBlur: 30 })?.id).toBe('inkwell');
    expect(matchingThemePreset({ ...matte, texture: 'grid' })).toBeNull();
    expect(matchingThemePreset({ ...matte, customBackgroundUrl: 'upload' })).toBeNull();
  });

  it('knows which backgrounds are plain', () => {
    expect(isPlainBackground('solid:#1c1c21')).toBe(true);
    expect(isPlainBackground('graphite')).toBe(true);
    expect(isPlainBackground('fuji')).toBe(false);
  });
});
