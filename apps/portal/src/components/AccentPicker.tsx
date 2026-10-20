import { ACCENT_PRESETS, MAX_SAVED_ACCENTS } from '@komogon/core';
import { accentHexFor, hexToRgb, rgbToHsl } from '@komogon/ui';
import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface AccentPickerProps {
  /** The accent in use: a preset id or 'custom:<h>,<s>,<l>'. */
  value: string;
  /** The user's own colours, as 'custom:' accents. */
  saved: string[];
  onChange: (patch: { accent?: string; savedAccents?: string[] }) => void;
}

/**
 * A picked colour as a custom accent, exactly as picked. Text stays readable by other means:
 * accent text is moved in lightness only where it sits (readableAccent), and labels on a
 * fill switch between white and dark (ownAccentFill).
 */
function toAccent(hex: string): string {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  return `custom:${h},${s},${l}`;
}

/**
 * A tile that opens the browser's colour chooser. While the chooser is open the tile only
 * previews the colour; it is saved once, when the chooser closes. Saving while it was open
 * moved the tile, and the browser closes a chooser whose input moves.
 */
function ColorTile({
  color,
  onCommit,
  className,
  title,
  label,
  pressed,
  onSelect,
  children,
}: {
  color: string;
  onCommit: (hex: string) => void;
  className: string;
  title: string;
  label: string;
  /** For a saved colour: selected, so a click opens the chooser rather than selecting. */
  pressed?: boolean;
  /** For a saved colour that is not selected yet: the click selects it instead. */
  onSelect?: () => void;
  children?: ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  }, [onCommit]);

  // React's onChange on a colour input fires on every step of a drag; the native `change`
  // fires once, when the chooser is closed on a colour.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const done = () => {
      commit.current(el.value);
      setDraft(null);
    };
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, []);

  return (
    <label
      className={className}
      title={title}
      aria-pressed={pressed}
      style={{ background: draft ?? color }}
      onClick={(e) => {
        if (onSelect && !pressed) {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      {children}
      <input
        ref={input}
        type="color"
        className="swatch-add-input"
        aria-label={label}
        value={draft ?? color}
        onChange={(e) => setDraft(e.target.value)}
      />
    </label>
  );
}

/**
 * The six built-in accents and up to eight of the user's own. The + tile opens the
 * browser's colour chooser and saves the colour when it closes; clicking one of your own
 * colours selects it, and clicking it again opens the chooser to change it.
 */
export function AccentPicker({ value, saved, onChange }: AccentPickerProps) {
  // A custom accent chosen before colours could be saved still shows, and can be kept.
  const own = value.startsWith('custom:') && !saved.includes(value) ? [...saved, value] : saved;
  const room = own.length < MAX_SAVED_ACCENTS;

  const add = (hex: string) => {
    const accent = toAccent(hex);
    onChange({ accent, savedAccents: [...own, accent].slice(0, MAX_SAVED_ACCENTS) });
  };
  const replace = (i: number, hex: string) => {
    const accent = toAccent(hex);
    const next = [...own];
    next[i] = accent;
    onChange({ accent, savedAccents: next });
  };
  const remove = (accent: string) => {
    const next = own.filter((a) => a !== accent);
    onChange({ savedAccents: next, ...(value === accent ? { accent: 'sky' } : {}) });
  };

  return (
    <div className="pill-row items-center">
      {ACCENT_PRESETS.map((a) => (
        <button
          key={a.id}
          type="button"
          className="swatch"
          aria-pressed={value === a.id}
          aria-label={a.name}
          title={a.name}
          style={{ background: accentHexFor(a.id) }}
          onClick={() => onChange({ accent: a.id })}
        />
      ))}
      {own.map((a, i) => (
        // Keyed by slot, not colour: changing a colour must not remount its open chooser.
        <span key={i} className="swatch-own">
          <ColorTile
            className="swatch"
            color={accentHexFor(a)}
            pressed={value === a}
            onSelect={() => onChange({ accent: a })}
            onCommit={(hex) => replace(i, hex)}
            title={value === a ? 'Click to change this colour' : 'Your colour'}
            label={
              value === a
                ? `Change your colour ${accentHexFor(a)}`
                : `Your colour ${accentHexFor(a)}`
            }
          />
          <button
            type="button"
            className="swatch-remove"
            aria-label={`Remove your colour ${accentHexFor(a)}`}
            title="Remove"
            onClick={() => remove(a)}
          >
            <X size={10} aria-hidden />
          </button>
        </span>
      ))}
      {room && (
        <ColorTile
          className="swatch swatch-add"
          color="#7c6cf0"
          onCommit={add}
          title="Add your own colour"
          label="Add your own accent colour"
        >
          <Plus size={16} aria-hidden />
        </ColorTile>
      )}
      <span className="field-hint">
        {own.length} of {MAX_SAVED_ACCENTS} of your own
      </span>
    </div>
  );
}
