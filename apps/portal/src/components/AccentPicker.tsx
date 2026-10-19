import { ACCENT_PRESETS, MAX_SAVED_ACCENTS } from '@komogon/core';
import { accentHexFor, hexToRgb, rgbToHsl } from '@komogon/ui';
import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

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
 * The six built-in accents and up to eight of the user's own. The + tile opens
 * the browser's colour chooser; dragging across it saves one colour, not one per step.
 */
export function AccentPicker({ value, saved, onChange }: AccentPickerProps) {
  // A custom accent chosen before colours could be saved still shows, and can be kept.
  const own = value.startsWith('custom:') && !saved.includes(value) ? [...saved, value] : saved;
  const room = own.length < MAX_SAVED_ACCENTS;

  const [draft, setDraft] = useState('#7c6cf0');
  const timer = useRef(0);
  /** The slot this visit to the colour chooser is filling, once its first colour is saved. */
  const slot = useRef<number | null>(null);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const pick = (hex: string) => {
    setDraft(hex);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const accent = toAccent(hex);
      const next = [...own];
      if (slot.current === null) {
        slot.current = next.length;
        next.push(accent);
      } else {
        next[slot.current] = accent;
      }
      onChange({ accent, savedAccents: next.slice(0, MAX_SAVED_ACCENTS) });
    }, 300);
  };

  const remove = (accent: string) => {
    const next = own.filter((a) => a !== accent);
    onChange({ savedAccents: next, ...(value === accent ? { accent: 'indigo' } : {}) });
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
      {own.map((a) => (
        <span key={a} className="swatch-own">
          <button
            type="button"
            className="swatch"
            aria-pressed={value === a}
            aria-label={`Your colour ${accentHexFor(a)}`}
            title="Your colour"
            style={{ background: accentHexFor(a) }}
            onClick={() => onChange({ accent: a })}
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
        <label className="swatch swatch-add" title="Add your own colour">
          <Plus size={16} aria-hidden />
          <input
            type="color"
            className="swatch-add-input"
            aria-label="Add your own accent colour"
            value={draft}
            onFocus={() => (slot.current = null)}
            onClick={() => (slot.current = null)}
            onChange={(e) => pick(e.target.value)}
          />
        </label>
      )}
      <span className="field-hint">
        {own.length} of {MAX_SAVED_ACCENTS} of your own
      </span>
    </div>
  );
}
