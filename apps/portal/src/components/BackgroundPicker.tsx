import {
  BACKGROUND_CATEGORY_LABELS,
  BACKGROUNDS,
  isBackgroundAvailable,
  solidBackgroundId,
  solidColorOf,
  type BackgroundMeta,
} from '@komogon/core';
import { BackgroundThumb, type ResolvedTheme } from '@komogon/ui';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

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
  /**
   * Which picker this is, for remembering whether it was minimized: the page's background
   * and the extension's own are folded away separately.
   */
  collapseKey?: string;
}

/** Whether a picker was left minimized, per picker, in this browser only. */
function useMinimized(key: string): [boolean, (v: boolean) => void] {
  const storageKey = `komogon.bgPicker.${key}.minimized`;
  const [minimized, set] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });
  const update = (v: boolean) => {
    set(v);
    try {
      if (v) localStorage.setItem(storageKey, '1');
      else localStorage.removeItem(storageKey);
    } catch {
      // Storage blocked: it stays as chosen until the page reloads.
    }
  };
  return [minimized, update];
}

/** The name of what is chosen, for the minimized picker. */
function chosenName(value: string): string {
  if (solidColorOf(value)) return 'Solid colour';
  if (value === '' || value === 'upload') return 'Your uploaded image';
  return BACKGROUNDS.find((b) => b.id === value)?.name ?? 'Default';
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
  collapseKey = 'page',
}: BackgroundPickerProps) {
  const navigate = useNavigate();
  const [minimized, setMinimized] = useMinimized(collapseKey);
  /** A locked background offers the way to it: Achievements, scrolled to it and lit up. */
  const offerShop = (b: BackgroundMeta) => {
    const how = b.costXp !== null ? 'is in the shop' : `unlocks at level ${b.minLevel}`;
    if (window.confirm(`${b.name} ${how}. See it in Achievements?`))
      navigate(`/achievements#bg-${b.id}`);
  };
  const groups = BACKGROUND_CATEGORY_LABELS.map((c) => ({
    ...c,
    items: BACKGROUNDS.filter((b) => b.category === c.id),
  })).filter((g) => g.items.length > 0);

  const preset = BACKGROUNDS.some((b) => b.id === value);
  if (minimized)
    return (
      <div className="bg-minimized">
        {preset ? (
          <BackgroundThumb id={value} theme={theme} label={chosenName(value)} selected />
        ) : (
          <span className="bg-minimized-name">{chosenName(value)}</span>
        )}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMinimized(false)}>
          <ChevronDown size={14} aria-hidden /> Show all backgrounds
        </button>
      </div>
    );

  return (
    <div className="bg-groups">
      <div className="bg-groups-head">
        <span className="field-hint">
          {chosenName(value)} is on now. {BACKGROUNDS.length} to choose from.
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMinimized(true)}>
          <ChevronUp size={14} aria-hidden /> Minimize
        </button>
      </div>
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
                  className={available ? undefined : 'is-locked'}
                  onClick={() => (available ? onChange(b.id) : offerShop(b))}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
