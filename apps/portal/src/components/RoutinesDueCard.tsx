import type { RoutineOccurrence } from '@komogon/core';
import { announceAchievements } from '../lib/achievements';
import { Check, Play } from 'lucide-react';
import { Link } from 'react-router';
import { Button, Chip, Glass, useToast } from '@komogon/ui';
import { useRoutines, useTickRoutine } from '../lib/queries';
import { occurrenceKey, useTickedRoutines } from '../lib/routine-ticks';

/**
 * Today's outstanding recurring tasks: tick one off in place, or start it as a timed
 * session and tick it off at the end. Hidden entirely when the user has no routines, so
 * the page does not grow a permanently empty card.
 */
export function RoutinesDueCard({
  onStart,
}: {
  /** Absent while a session is running: one at a time. */
  onStart?: (occ: RoutineOccurrence) => void;
}) {
  const q = useRoutines();
  const tick = useTickRoutine();
  const { toast } = useToast();
  const due = useTickedRoutines(q.data?.due ?? []);

  if (!q.data || q.data.routines.length === 0) return null;

  const off = async (o: RoutineOccurrence, from: HTMLElement) => {
    if (due.ticked.has(occurrenceKey(o))) return;
    due.tick(o, from);
    try {
      const res = await tick.mutateAsync({ id: o.routineId, date: o.date });
      if (res.xpAwarded > 0) toast(`+${res.xpAwarded} XP`, { tone: 'ok' });
      announceAchievements(res.badges);
    } catch (err) {
      due.release(o);
      toast(err instanceof Error ? err.message : 'Could not tick that off.');
    }
  };

  return (
    <Glass className="p-5 flex flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg flex-1">Routines</h2>
        <Link to="/routines" className="text-sm">
          All routines
        </Link>
      </div>
      {due.rows.length === 0 ? (
        <p className="routine-empty muted text-sm fade-in" style={{ minHeight: due.emptyHeight }}>
          Everything due is ticked off.
        </p>
      ) : (
        <ul className="routine-list">
          {due.rows.map((o) => {
            const key = occurrenceKey(o);
            const ticked = due.ticked.has(key);
            return (
              <li
                key={key}
                className={`routine-row${ticked ? ' is-done is-ticked is-leaving' : ''}${ticked && due.last === key ? ' is-last' : ''}`}
              >
                <button
                  type="button"
                  className="routine-tick"
                  role="checkbox"
                  aria-checked={ticked}
                  aria-label={`Tick off ${o.title}`}
                  onClick={(e) => void off(o, e.currentTarget)}
                >
                  <Check size={14} aria-hidden />
                </button>
                <span className="flex-1 min-w-0 truncate">
                  <span className="routine-title">{o.title}</span>
                </span>
                {o.overdue && <Chip tone="warn">missed</Chip>}
                <span className="muted text-sm tabular">{o.estimatedMinutes}m</span>
                {onStart && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    aria-label={`Start a session for ${o.title}`}
                    title="Start a session"
                    disabled={ticked}
                    onClick={() => onStart(o)}
                  >
                    <Play size={14} aria-hidden />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Glass>
  );
}
