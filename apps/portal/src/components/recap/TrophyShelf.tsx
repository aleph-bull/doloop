import type { PersonalRecord } from '@komogon/core';
import { fireSparks, prefersStill } from '@komogon/ui';
import { useEffect, useRef } from 'react';
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

/** A record's identity for "have I celebrated this one": the record and its figure. */
const idOf = (r: PersonalRecord) => `${r.key}:${r.display}:${r.when ?? ''}`;

/**
 * Personal bests as a row of medals. A record set this week wears NEW; the first time the
 * user sees it, a few sparks fly off the medal. Early starts and late finishes are here
 * because they are fun, not because either is better.
 */
export function TrophyShelf({ records }: { records: PersonalRecord[] }) {
  const refs = useRef(new Map<string, HTMLElement>());

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
    <ul className="trophies">
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
          {r.when && (
            <span className="trophy-when">
              {r.key === 'biggest-week' || r.key === 'most-tasks-week' ? 'week of ' : ''}
              {fmtDate(`${r.when}T12:00:00`)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
