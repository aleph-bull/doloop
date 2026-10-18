import {
  BACKGROUND_CATEGORY_LABELS,
  BACKGROUNDS,
  isBackgroundAvailable,
  solidBackgroundId,
  solidColorOf,
  type BackgroundMeta,
} from '@komogon/core';
import { BackgroundThumb, type ResolvedTheme } from '@komogon/ui';
import { useEffect, useRef, useState } from 'react';

/** Where the colour chooser starts before one was ever picked: a quiet dark slate. */
const DEFAULT_SOLID = '#1f2433';

/**
 * Any plain colour, from the browser's colour chooser. Saved a moment after the colour
 * stops moving, so dragging across the chooser is one save, not hundreds.
 */
function SolidColourTile({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const current = solidColorOf(value);
  const [draft, setDraft] = useState(current ?? DEFAULT_SOLID);
  useEffect(() => {
    if (current) setDraft(current);
  }, [current]);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const pick = (hex: string) => {
    setDraft(hex);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onChange(solidBackgroundId(hex)), 300);
  };
  return (
    <label
      className={`bg-thumb bg-thumb-solid${current ? ' is-selected' : ''}`}
      style={{ background: draft }}
      title="Pick any colour"
    >
      <input
        type="color"
        className="bg-solid-input"
        value={draft}
        aria-label="Solid colour background"
        onChange={(e) => pick(e.target.value)}
      />
      <span className="bg-thumb-label">Solid colour</span>
    </label>
  );
}

export interface BackgroundPickerProps {
  /** Currently selected id. */
  value: string;
  level: number;
  purchased: string[];
  theme: ResolvedTheme;
  onChange: (id: string) => void;
  /** Rendered as the first tile of the first group, e.g. the uploaded image. */
  leading?: React.ReactNode;
}

/** What the tile says when it is not yet available. Prices live in the shop, not here. */
function lockLabel(b: BackgroundMeta): string {
  if (b.costXp !== null) return 'In the shop';
  return `Level ${b.minLevel}`;
}

/** Where to go to unlock it. */
function lockHint(b: BackgroundMeta): string {
  if (b.costXp !== null) return 'buy it in Achievements';
  return `unlocks at level ${b.minLevel}`;
}

/**
 * The full catalogue, grouped by category. Locked backgrounds stay visible but dimmed and
 * disabled, labelled with what unlocks them, so the shop is discoverable from here.
 */
export function BackgroundPicker({
  value,
  level,
  purchased,
  theme,
  onChange,
  leading,
}: BackgroundPickerProps) {
  const groups = BACKGROUND_CATEGORY_LABELS.map((c) => ({
    ...c,
    items: BACKGROUNDS.filter((b) => b.category === c.id),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="bg-groups">
      {groups.map((group, gi) => (
        <div key={group.id} className="bg-group">
          <h4 className="bg-group-title">{group.label}</h4>
          <div className="bg-grid">
            {gi === 0 && (
              <>
                <SolidColourTile value={value} onChange={onChange} />
                {leading}
              </>
            )}
            {group.items.map((b) => {
              const available = isBackgroundAvailable(b.id, level, purchased);
              return (
                <BackgroundThumb
                  key={b.id}
                  id={b.id}
                  theme={theme}
                  label={b.name}
                  badge={available ? undefined : lockLabel(b)}
                  ariaLabel={available ? b.name : `${b.name}, ${lockLabel(b)}`}
                  title={available ? b.name : `${b.name} — ${lockHint(b)}`}
                  selected={value === b.id}
                  disabled={!available}
                  onClick={() => onChange(b.id)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
