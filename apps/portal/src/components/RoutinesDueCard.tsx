import type { RoutineOccurrence } from '@doloop/core';
import { Check, Play } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button, Chip, Glass, useToast } from '@doloop/ui';
import { useRoutines, useTickRoutine } from '../lib/queries';

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
  const [busy, setBusy] = useState<string | null>(null);

  if (!q.data || q.data.routines.length === 0) return null;
  const { due } = q.data;

  const off = async (routineId: string, date: string) => {
    setBusy(`${routineId}:${date}`);
    try {
      const res = await tick.mutateAsync({ id: routineId, date });
      if (res.xpAwarded > 0) toast(`+${res.xpAwarded} XP`, { tone: 'ok' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not tick that off.');
    } finally {
      setBusy(null);
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
      {due.length === 0 ? (
        <p className="muted text-sm">Everything due is ticked off.</p>
      ) : (
        <ul className="routine-list">
          {due.map((o) => (
            <li key={`${o.routineId}:${o.date}`} className="routine-row">
              <button
                type="button"
                className="routine-tick"
                role="checkbox"
                aria-checked={false}
                aria-label={`Tick off ${o.title}`}
                disabled={busy === `${o.routineId}:${o.date}`}
                onClick={() => void off(o.routineId, o.date)}
              >
                <Check size={14} aria-hidden style={{ opacity: 0 }} />
              </button>
              <span className="flex-1 min-w-0 truncate">{o.title}</span>
              {o.overdue && <Chip tone="warn">missed</Chip>}
              <span className="muted text-sm tabular">{o.estimatedMinutes}m</span>
              {onStart && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label={`Start a session for ${o.title}`}
                  title="Start a session"
                  onClick={() => onStart(o)}
                >
                  <Play size={14} aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Glass>
  );
}
