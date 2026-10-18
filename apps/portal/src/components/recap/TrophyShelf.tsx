import type { PersonalRecord, RecordKey } from '@komogon/core';
import { fireSparks, prefersStill } from '@komogon/ui';
import { useEffect, useRef, useState } from 'react';
import { fmtDate } from '../../lib/format';

/** Records the user has already seen marked new, kept in this browser so the sparkle plays once. */
const SEEN_KEY = 'komogon.records-seen';

function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function writeSeen(seen: Set<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-100)));
  } catch {
    /* Storage blocked: the sparkle plays again next time, which is harmless. */
  }
}

/** Records dated by the Monday of their week, shown as "week of Sep 21". */
const WEEK_RECORDS = new Set<RecordKey>([
  'biggest-week',
  'most-tasks-week',
  'most-courses-week',
  'most-routines-week',
]);

function whenLabel(r: PersonalRecord & { when: string }): string {
  const day = `${r.when}T12:00:00`;
  if (r.key === 'biggest-month')
    return new Date(day).toLocaleDateString([], { month: 'long', year: 'numeric' });
  return `${WEEK_RECORDS.has(r.key) ? 'week of ' : ''}${fmtDate(day)}`;
}

/** The narrowest a medal gets, and the gap between them; matches .trophies in index.css. */
const MIN_TROPHY = 150;
const TROPHY_GAP = 12;

/**
 * Columns that share the medals out evenly: as many rows as the width needs, then as few
 * columns as fill them. Seven medals that fit six across sit four and three, not six and one.
 */
function balancedColumns(count: number, width: number): number {
  const fit = Math.max(1, Math.floor((width + TROPHY_GAP) / (MIN_TROPHY + TROPHY_GAP)));
  if (count <= fit) return Math.max(1, count);
  const rows = Math.ceil(count / fit);
  return Math.ceil(count / rows);
}

/** A record's identity for "have I celebrated this one": the record and its figure. */
const idOf = (r: PersonalRecord) => `${r.key}:${r.display}:${r.when ?? ''}`;

/**
 * Personal bests as a row of medals. A record set this week wears NEW; the first time the
 * user sees it, a few sparks fly off the medal. Early starts and late finishes are here
 * because they are fun, not because either is better.
 */
export function TrophyShelf({ records }: { records: PersonalRecord[] }) {
  const refs = useRef(new Map<string, HTMLElement>());
  const listRef = useRef<HTMLUListElement>(null);
  const [width, setWidth] = useState(0);
  const hasRecords = records.length > 0;

  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasRecords]);

  useEffect(() => {
    const seen = readSeen();
    const fresh = records.filter((r) => r.isNew && !seen.has(idOf(r)));
    if (fresh.length === 0) return;
    const t = window.setTimeout(() => {
      if (!prefersStill())
        for (const r of fresh) {
          const el = refs.current.get(r.key);
          if (!el) continue;
          const box = el.getBoundingClientRect();
          if (box.bottom < 0 || box.top > window.innerHeight) continue;
          fireSparks({ origin: { x: box.left + box.width / 2, y: box.top + 24 } });
        }
      for (const r of fresh) seen.add(idOf(r));
      writeSeen(seen);
    }, 700);
    return () => window.clearTimeout(t);
  }, [records]);

  if (records.length === 0)
    return (
      <p className="muted text-sm">
        Your personal bests land here: biggest day, longest session, longest streak, and a few more.
        One session puts the first on the shelf.
      </p>
    );

  return (
    <ul
      ref={listRef}
      className="trophies"
      style={
        width > 0
          ? {
              gridTemplateColumns: `repeat(${balancedColumns(records.length, width)}, minmax(0, 1fr))`,
            }
          : undefined
      }
    >
      {records.map((r) => (
        <li
          key={r.key}
          ref={(el) => {
            if (el) refs.current.set(r.key, el);
            else refs.current.delete(r.key);
          }}
          className={`trophy${r.isNew ? ' is-new' : ''}`}
        >
          {r.isNew && <span className="trophy-new">New</span>}
          <span className="trophy-icon" aria-hidden>
            {r.icon}
          </span>
          <span className="trophy-value">{r.display}</span>
          <span className="trophy-label">{r.label}</span>
          {r.when && <span className="trophy-when">{whenLabel({ ...r, when: r.when })}</span>}
        </li>
      ))}
    </ul>
  );
}
