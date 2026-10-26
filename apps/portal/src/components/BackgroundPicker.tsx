import {
  BACKGROUND_CATEGORY_LABELS,
  BACKGROUNDS,
  isBackgroundAvailable,
  solidBackgroundId,
  solidColorOf,
  THEME_TAGS,
  type BackgroundCategory,
  type BackgroundMeta,
  type ThemeTag,
} from '@komogon/core';
import { BackgroundThumb, Segmented, type ResolvedTheme } from '@komogon/ui';
import { ChevronDown, ChevronUp, ImagePlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { UploadedTile, UploadTile, type UploadedBackgrounds } from './CustomBackgrounds';

type Tab = ThemeTag | 'all' | 'yours';

/** Each category under one of the themes' tabs, so the two pickers are sorted alike. */
const TAB_OF: Record<BackgroundCategory, ThemeTag> = {
  minimal: 'minimalist',
  abstract: 'abstract',
  sky: 'nature',
  mountains: 'nature',
  lakes: 'nature',
  coast: 'nature',
  forest: 'nature',
  country: 'nature',
  desert: 'nature',
  night: 'night',
  cities: 'cities',
  lights: 'cities',
};

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
  /** Their own uploads, shown first as "Yours" with an Upload tile (Appearance only). */
  uploads?: UploadedBackgrounds;
  /**
   * No longer used: pickers always open minimized now (2026-10-20). Kept so callers that
   * still pass it compile.
   */
  collapseKey?: string;
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
 * The full catalogue, under the same tabs as the themes and grouped by category inside
 * them. Their own uploads are the Yours tab, which opens first when there is one. Locked
 * backgrounds stay visible but dimmed and disabled, labelled with what unlocks them, so the
 * shop is discoverable from here.
 */
export function BackgroundPicker({
  value,
  level,
  purchased,
  theme,
  onChange,
  leading,
  uploads,
}: BackgroundPickerProps) {
  const navigate = useNavigate();
  // Opens minimized every time: the full grid is long, and most visits to Settings are for
  // something else. "Show all backgrounds" opens it for this visit.
  const [minimized, setMinimized] = useState(true);
  const [tab, setTab] = useState<Tab>('all');
  const open = () => {
    setTab(uploads && uploads.items.length > 0 ? 'yours' : 'all');
    setMinimized(false);
  };
  /** A locked background offers the way to it: Achievements, scrolled to it and lit up. */
  const offerShop = (b: BackgroundMeta) => {
    const how = b.costXp !== null ? 'is in the shop' : `unlocks at level ${b.minLevel}`;
    if (window.confirm(`${b.name} ${how}. See it in Achievements?`))
      navigate(`/achievements#bg-${b.id}`);
  };
  const groups = BACKGROUND_CATEGORY_LABELS.map((c) => ({
    ...c,
    items: BACKGROUNDS.filter((b) => b.category === c.id),
  })).filter((g) => g.items.length > 0 && (tab === 'all' || TAB_OF[g.id] === tab));

  const preset = BACKGROUNDS.some((b) => b.id === value);
  const chosenUpload = uploads?.items.find((b) => b.id === uploads.chosen);
  if (minimized)
    return (
      <div className="bg-minimized">
        {uploads?.ui}
        {chosenUpload ? (
          <UploadedTile item={chosenUpload} selected onPick={open} />
        ) : preset ? (
          <BackgroundThumb id={value} theme={theme} label={chosenName(value)} selected />
        ) : (
          <span className="bg-minimized-name">{chosenName(value)}</span>
        )}
        <button type="button" className="btn btn-secondary btn-sm" onClick={open}>
          <ChevronDown size={14} aria-hidden /> Show all backgrounds
        </button>
        {uploads && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={uploads.busy}
            onClick={uploads.add}
          >
            <ImagePlus size={14} aria-hidden /> Upload
          </button>
        )}
      </div>
    );

  return (
    <div className="bg-groups">
      {uploads?.ui}
      <div className="picker-head">
        <Segmented
          ariaLabel="Background tags"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'all', label: 'All' },
            ...(uploads ? [{ value: 'yours' as const, label: 'Yours' }] : []),
            ...THEME_TAGS.map((t) => ({ value: t.id, label: t.label })),
          ]}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMinimized(true)}>
          <ChevronUp size={14} aria-hidden /> Minimize
        </button>
      </div>
      {tab === 'yours' && uploads ? (
        <div className="bg-grid">
          <UploadTile uploads={uploads} />
          {uploads.items.map((b) => (
            <UploadedTile
              key={b.id}
              item={b}
              selected={uploads.chosen === b.id}
              onPick={() => uploads.pick(b.id)}
              onRemove={() => uploads.remove(b.id)}
            />
          ))}
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.id} className="bg-group">
            {groups.length > 1 && <h4 className="bg-group-title">{group.label}</h4>}
            <div className="bg-grid">
              {group.id === 'minimal' && (
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
        ))
      )}
    </div>
  );
}
