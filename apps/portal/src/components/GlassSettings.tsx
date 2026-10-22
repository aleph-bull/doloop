import { DEFAULT_SETTINGS } from '@komogon/core';
import {
  applyGlassFrost,
  Button,
  chooseGlass,
  Slider,
  THEME_GLASS,
  type ResolvedTheme,
} from '@komogon/ui';
import { useEffect, useRef, useState } from 'react';

type GlassPatch = {
  theme: {
    glassColor?: string | null;
    glassAlpha?: number | null;
    glassBlur?: number;
    glassSaturate?: number;
  };
};

export interface GlassSettingsProps {
  glassColor: string | null;
  glassAlpha: number | null;
  glassBlur: number;
  glassSaturate: number;
  theme: ResolvedTheme;
  onChange: (patch: GlassPatch) => Promise<unknown>;
}

interface Draft {
  color?: string;
  alpha?: number;
  blur?: number;
  saturate?: number;
}

const DEFAULTS = DEFAULT_SETTINGS.theme;

const toHex = (rgb: readonly number[]) =>
  `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

/**
 * The glass's colour, weight, blur and colour boost (Appearance › Advanced). Dragging shows
 * it on the page straight away; letting go saves it, and the backdrop then works it out
 * properly against the photo (text colour included).
 */
export function GlassSettings({
  glassColor,
  glassAlpha,
  glassBlur,
  glassSaturate,
  theme,
  onChange,
}: GlassSettingsProps) {
  const own = THEME_GLASS[theme];
  // What is being dragged, until the saved settings come back with it (or change elsewhere:
  // a saved look, the reset, another tab), when the draft gives way to them.
  const [draft, setDraft] = useState<Draft>({});
  const saved = `${glassColor}|${glassAlpha}|${glassBlur}|${glassSaturate}`;
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) {
    setSeen(saved);
    setDraft({});
  }
  const color = draft.color ?? glassColor ?? toHex(own.fill);
  const alpha = draft.alpha ?? glassAlpha ?? own.alpha;
  const blur = draft.blur ?? glassBlur;
  const saturate = draft.saturate ?? glassSaturate;

  const showFill = (c: string | null, a: number) => {
    const chosen = chooseGlass({ color: c, alpha: a }, theme, null, own);
    if (!chosen) return;
    const root = document.documentElement.style;
    root.setProperty('--glass-fill', `rgb(${chosen.fill.join(' ')} / ${chosen.alpha})`);
    root.setProperty(
      '--glass-fill-strong',
      `rgb(${chosen.fill.join(' ')} / ${chosen.strongAlpha})`,
    );
  };

  // The colour picker sends a stream of changes while it is open; save once it settles.
  const colorTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(colorTimer.current), []);
  const pickColor = (hex: string) => {
    setDraft((d) => ({ ...d, color: hex }));
    showFill(hex, alpha);
    window.clearTimeout(colorTimer.current);
    colorTimer.current = window.setTimeout(
      () => void onChange({ theme: { glassColor: hex } }),
      400,
    );
  };

  const isDefault =
    glassColor === null &&
    glassAlpha === null &&
    glassBlur === DEFAULTS.glassBlur &&
    glassSaturate === DEFAULTS.glassSaturate;

  const saveOn = (save: () => void) => ({ onPointerUp: save, onKeyUp: save });

  return (
    <div className="field">
      <span className="field-label">Glass</span>
      <div className="glass-controls">
        <span>Colour</span>
        <input
          type="color"
          className="glass-color"
          aria-label="Glass colour"
          value={color}
          onChange={(e) => pickColor(e.target.value)}
        />
        <span />

        <span>Weight</span>
        <Slider
          min={0.3}
          max={0.95}
          step={0.01}
          value={alpha}
          aria-label="Glass weight"
          onChange={(v) => {
            setDraft((d) => ({ ...d, alpha: v }));
            showFill(draft.color ?? glassColor, v);
          }}
          {...saveOn(() => void onChange({ theme: { glassAlpha: alpha } }))}
        />
        <span className="tabular">{Math.round(alpha * 100)}%</span>

        <span>Blur</span>
        <Slider
          min={0}
          max={40}
          step={1}
          value={blur}
          aria-label="Glass blur"
          onChange={(v) => {
            setDraft((d) => ({ ...d, blur: v }));
            applyGlassFrost(v, saturate);
          }}
          {...saveOn(() => void onChange({ theme: { glassBlur: blur } }))}
        />
        <span className="tabular">{blur}px</span>

        <span>Colourful</span>
        <Slider
          min={100}
          max={200}
          step={5}
          value={saturate}
          aria-label="How colourful the glass is"
          onChange={(v) => {
            setDraft((d) => ({ ...d, saturate: v }));
            applyGlassFrost(blur, v);
          }}
          {...saveOn(() => void onChange({ theme: { glassSaturate: saturate } }))}
        />
        <span className="tabular">{saturate}%</span>
      </div>
      <span className="field-hint">
        Weight is how much of the colour covers the background. Cards use the glass when Panels is
        Glass; the sidebar or top bar and dialogs always do.
      </span>
      {!isDefault && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() =>
            void onChange({
              theme: {
                glassColor: null,
                glassAlpha: null,
                glassBlur: DEFAULTS.glassBlur,
                glassSaturate: DEFAULTS.glassSaturate,
              },
            })
          }
        >
          Back to the default glass
        </Button>
      )}
    </div>
  );
}
