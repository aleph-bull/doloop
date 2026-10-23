import {
  THEME_PRESETS,
  themePresetPatch,
  type OnboardingLookId,
  type ThemeMode,
  type ThemePreset,
  type UserSettings,
} from '@komogon/core';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/**
 * The theme behind each look the setup offers first, light and dark (the owner's picks,
 * 2026-10-22). Dawn Skies keeps its photo and changes only its mode; Minimalist is two
 * themes of its own.
 */
const LOOKS: Record<
  OnboardingLookId,
  Record<'light' | 'dark', { preset: string; mode?: ThemeMode }>
> = {
  'dawn-skies': {
    light: { preset: 'dawn-skies', mode: 'light' },
    dark: { preset: 'dawn-skies', mode: 'dark' },
  },
  minimalist: {
    light: { preset: 'off-white' },
    dark: { preset: 'inkwell' },
  },
};

/** The preset a look comes to, with the mode set where the look sets one. */
export function lookPreset(id: OnboardingLookId, dark: boolean): ThemePreset {
  const pick = LOOKS[id][dark ? 'dark' : 'light'];
  const preset = THEME_PRESETS.find((p) => p.id === pick.preset) ?? THEME_PRESETS[0]!;
  return pick.mode ? { ...preset, look: { ...preset.look, mode: pick.mode } } : preset;
}

/** What picking a look saves: the whole theme. */
export function lookPatch(id: OnboardingLookId, dark: boolean): DeepPartial<UserSettings> {
  return { theme: themePresetPatch(lookPreset(id, dark)) };
}
