import {
  DEFAULT_SETTINGS,
  matchingThemePreset,
  THEME_PRESETS,
  THEME_TAGS,
  themePresetPatch,
  type ThemePreset,
  type ThemeTag,
  type UserSettings,
} from '@komogon/core';
import {
  accentHexFor,
  backgroundById,
  resolveTheme,
  Segmented,
  textureStyle,
  tonalSurfaces,
  useToast,
  type ResolvedTheme,
  type RGB,
} from '@komogon/ui';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { loadPresets } from '../lib/appearance-presets';
import { AppearancePresets } from './AppearancePresets';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface ThemePickerProps {
  theme: UserSettings['theme'];
  resolved: ResolvedTheme;
  patch: (p: DeepPartial<UserSettings>) => Promise<unknown>;
  /** After a saved look put an uploaded image back, so the backdrop reloads it. */
  onImageApplied: () => void;
}

type Tab = ThemeTag | 'all' | 'custom';

const TAG_LABEL = Object.fromEntries(THEME_TAGS.map((t) => [t.id, t.label])) as Record<
  ThemeTag,
  string
>;

const rgb = (c: RGB) => `rgb(${c.join(' ')})`;

/**
 * Light or dark, as the preset comes out: its own mode if it sets one (the flat colours), or
 * the mode in use (`current`), which the others keep.
 */
export function lookTheme(p: ThemePreset, current?: ResolvedTheme): ResolvedTheme {
  return p.look.mode
    ? resolveTheme(p.look.mode)
    : (current ?? resolveTheme(DEFAULT_SETTINGS.theme.mode));
}

/** The preview's background: the photo's thumbnail, or the colour or gradient with its texture. */
export function backgroundStyle(p: ThemePreset, resolved: ResolvedTheme): CSSProperties {
  const def = backgroundById(p.look.backgroundId);
  if (def.photo)
    return {
      backgroundImage: `url("/${def.photo.thumb}"), url("${def.photo.lqip}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  return { background: (resolved === 'dark' ? def.dark : def.light).css };
}

/** The little card on the preview in the preset's panels, and its text colour. */
export function cardLook(
  p: ThemePreset,
  resolved: ResolvedTheme,
): { card: CSSProperties; ink: string } {
  const dark = resolved === 'dark';
  const solid = backgroundById(p.look.backgroundId).solid;
  if (p.look.panel === 'matte' && solid) {
    const t = tonalSurfaces(solid, resolved);
    const edge = t.lightText ? 'rgb(255 255 255 / 0.07)' : 'rgb(0 0 0 / 0.07)';
    return { card: { background: rgb(t.card), border: `1px solid ${edge}` }, ink: rgb(t.ink) };
  }
  if (p.look.panel === 'matte')
    return {
      card: { background: dark ? '#181a25' : '#fbfbfd' },
      ink: dark ? 'rgb(244 245 249)' : 'rgb(15 18 32)',
    };
  return {
    card: {
      background: dark ? 'rgb(22 24 36 / 0.5)' : 'rgb(255 255 255 / 0.6)',
      border: `1px solid ${dark ? 'rgb(255 255 255 / 0.12)' : 'rgb(255 255 255 / 0.7)'}`,
      backdropFilter: 'blur(6px)',
    },
    ink: dark ? 'rgb(244 245 249)' : 'rgb(15 18 32)',
  };
}

function ThemeCard({
  preset,
  current,
  active,
  onPick,
}: {
  preset: ThemePreset;
  /** Light or dark now, which a preset without its own mode keeps. */
  current: ResolvedTheme;
  active: boolean;
  onPick: () => void;
}) {
  const resolved = lookTheme(preset, current);
  const def = backgroundById(preset.look.backgroundId);
  const pattern = def.photo
    ? null
    : textureStyle(preset.look.texture, (resolved === 'dark' ? def.dark : def.light).luminance);
  const { card, ink } = cardLook(preset, resolved);
  return (
    <div className="preset">
      <button
        type="button"
        className={`preset-preview theme-preview${active ? ' is-selected' : ''}`}
        style={backgroundStyle(preset, resolved)}
        aria-pressed={active}
        aria-label={`${preset.name}, ${TAG_LABEL[preset.tag]}`}
        onClick={onPick}
      >
        {pattern && <span className="theme-texture" style={pattern} aria-hidden />}
        <span className="preset-panel theme-panel" style={card}>
          <span
            className="preset-accent"
            style={{ background: accentHexFor(preset.look.accent) }}
          />
          <span className="preset-lines" style={{ '--theme-ink': ink } as CSSProperties}>
            <span />
            <span />
          </span>
        </span>
      </button>
      <div className="preset-foot">
        <span className="theme-name-row">
          <span className="preset-name truncate">{preset.name}</span>
          {active && <Check size={14} className="theme-check" aria-label="In use" />}
        </span>
        <span className="preset-kind">{TAG_LABEL[preset.tag]}</span>
      </div>
    </div>
  );
}

/**
 * Preset themes: a whole look (light or dark, accent, background, panels, glass, texture)
 * in one click, filtered by tag. The one in use is ticked. Custom holds the saved looks,
 * and opens first when there is at least one. Opens minimized every time, like the
 * background picker: the theme in use and "Show all themes".
 */
export function ThemePicker({ theme, resolved, patch, onImageApplied }: ThemePickerProps) {
  const { toast } = useToast();
  const current = matchingThemePreset(theme);
  const [minimized, setMinimized] = useState(true);
  const [tag, setTag] = useState<Tab>(() => (loadPresets().length > 0 ? 'custom' : 'all'));
  const shown = tag === 'all' ? THEME_PRESETS : THEME_PRESETS.filter((p) => p.tag === tag);

  const pick = (p: ThemePreset) => {
    patch({ theme: themePresetPatch(p) }).catch((err: unknown) =>
      toast(err instanceof Error ? err.message : 'Could not change the theme'),
    );
  };

  if (minimized)
    return (
      <div className="field">
        <span className="field-label">Themes</span>
        <div className="bg-minimized theme-minimized">
          {current ? (
            <ThemeCard
              preset={current}
              current={resolved}
              active
              onPick={() => setMinimized(false)}
            />
          ) : (
            <span className="bg-minimized-name">Custom</span>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setMinimized(false)}
          >
            <ChevronDown size={14} aria-hidden /> Show all themes
          </button>
        </div>
      </div>
    );

  return (
    <div className="field">
      <span className="field-label">Themes</span>
      <div className="picker-head">
        <Segmented
          ariaLabel="Theme tags"
          value={tag}
          onChange={setTag}
          options={[
            { value: 'all', label: 'All' },
            { value: 'custom', label: 'Custom' },
            ...THEME_TAGS.map((t) => ({ value: t.id, label: t.label })),
          ]}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMinimized(true)}>
          <ChevronUp size={14} aria-hidden /> Minimize
        </button>
      </div>
      {tag === 'custom' ? (
        <AppearancePresets
          theme={theme}
          resolved={resolved}
          patch={patch}
          onImageApplied={onImageApplied}
        />
      ) : (
        <div className="preset-grid theme-grid">
          {shown.map((p) => (
            <ThemeCard
              key={p.id}
              preset={p}
              current={resolved}
              active={current?.id === p.id}
              onPick={() => pick(p)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
