import type { RoutineOccurrence } from '@komogon/core';
import { fireSparks } from '@komogon/ui';
import { useEffect, useState } from 'react';

/**
 * How long a ticked row stays in a due list: the check, the strike, then the fold. Covers
 * the `routine-*` keyframes in index.css, which run on multiples of `--dur-slow`.
 */
const TICK_MS = 950;

export const occurrenceKey = (o: RoutineOccurrence) => `${o.routineId}:${o.date}`;

/**
 * A list of due routines that ticks off in place. The refetch after a tick drops the
 * occurrence from `due` within milliseconds, which would unmount its row mid-animation,
 * so the list shown holds still from the first tick until the last one has played out.
 * `ticked` is drawn as done before the server answers; `release` puts one back (the tick
 * failed, or it was unticked).
 *
 * The tick that empties the list is `last`: that row fades where it stands instead of
 * folding away, and the empty line takes its place at `emptyHeight`, so the card does not
 * shrink and then grow back.
 */
export function useTickedRoutines(due: readonly RoutineOccurrence[]) {
  // An object, not the bare list, so every tick restarts the timer below.
  const [hold, setHold] = useState<{ rows: readonly RoutineOccurrence[] } | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  const [last, setLast] = useState<{ key: string; height: number } | null>(null);

  useEffect(() => {
    if (!hold) return;
    const t = window.setTimeout(() => setHold(null), TICK_MS);
    return () => window.clearTimeout(t);
  }, [hold]);

  const rows = hold?.rows ?? due;
  return {
    rows,
    ticked,
    last: last?.key ?? null,
    emptyHeight: last?.height,
    /** `from` is the checkbox that was clicked; the sparks fly from it. */
    tick(o: RoutineOccurrence, from: HTMLElement) {
      const box = from.getBoundingClientRect();
      fireSparks({ origin: { x: box.left + box.width / 2, y: box.top + box.height / 2 } });
      const key = occurrenceKey(o);
      // Only a row of this list counts: the Routines week grid ticks through here too.
      if (rows.some((r) => occurrenceKey(r) === key)) {
        const emptied = rows.every((r) => occurrenceKey(r) === key || ticked.has(occurrenceKey(r)));
        const height = from.closest('li')?.getBoundingClientRect().height ?? 0;
        setLast((l) => (emptied ? { key, height } : l?.key === key ? null : l));
      }
      setHold((h) => ({ rows: h?.rows ?? rows }));
      setTicked((s) => new Set(s).add(key));
    },
    release(o: RoutineOccurrence) {
      setTicked((s) => {
        const next = new Set(s);
        next.delete(occurrenceKey(o));
        return next;
      });
    },
  };
}
