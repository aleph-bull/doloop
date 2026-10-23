import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './defaults';
import { isAccentUnlocked, isBackgroundAvailable } from './economy';
import {
  isPlainBackground,
  matchingThemePreset,
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

  it('the three minimalist colours are matte solids', () => {
    for (const id of ['off-white', 'night-shift', 'warm-charcoal']) {
      const p = THEME_PRESETS.find((x) => x.id === id)!;
      expect(p.tag).toBe('minimalist');
      expect(p.look.panel).toBe('matte');
      expect(p.look.backgroundId).toMatch(/^solid:#[0-9a-f]{6}$/);
    }
  });

  it('matches a preset once it is put on, and not after a change', () => {
    for (const p of THEME_PRESETS) {
      const on = { ...theme, ...themePresetPatch(p) };
      expect(matchingThemePreset(on)?.id).toBe(p.id);
      expect(matchingThemePreset({ ...on, accent: 'custom:1,2,3' })).toBeNull();
    }
  });

  it('ignores what does not show', () => {
    const peak = THEME_PRESETS.find((p) => p.id === 'cherry-peak')!;
    const on = { ...theme, ...themePresetPatch(peak) };
    // A texture never shows on a photo.
    expect(matchingThemePreset({ ...on, texture: 'dots' })?.id).toBe('cherry-peak');
    const charcoal = THEME_PRESETS.find((p) => p.id === 'warm-charcoal')!;
    const matte = { ...theme, ...themePresetPatch(charcoal) };
    // Matte panels have no glass.
    expect(matchingThemePreset({ ...matte, glassBlur: 30 })?.id).toBe('warm-charcoal');
    expect(matchingThemePreset({ ...matte, texture: 'grid' })).toBeNull();
    expect(matchingThemePreset({ ...matte, customBackgroundUrl: 'upload' })).toBeNull();
  });

  it('knows which backgrounds are plain', () => {
    expect(isPlainBackground('solid:#262624')).toBe(true);
    expect(isPlainBackground('graphite')).toBe(true);
    expect(isPlainBackground('fuji')).toBe(false);
  });
});
