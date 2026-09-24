import type { Routine, RoutineOccurrence } from '@komogon/core';
import { announceAchievements } from '../lib/achievements';
import { addDays, describeRecurrence, pathLabel, startOfWeekMonday } from '@komogon/core';
import { Check, Pencil, Play, Plus, Repeat, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { Button, Chip, Glass, Panel, ProgressBar, Spinner, useToast } from '@komogon/ui';
import { ErrorPanel } from '../components/ErrorState';
import { IcsImportDialog } from '../components/IcsImportDialog';
import { RoutineDialog } from '../components/RoutineDialog';
import { StartSessionDialog } from '../components/StartSessionDialog';
import { fmtDate } from '../lib/format';
import { occurrenceKey, useTickedRoutines } from '../lib/routine-ticks';
import {
  useActiveSession,
  useCreateRoutine,
  useDeleteRoutine,
  useImportRoutineIcs,
  useNodes,
  useRoutines,
  useTickRoutine,
  useUntickRoutine,
  useUpdateRoutine,
} from '../lib/queries';

const DAY_LABEL = (date: string, today: string) => {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  if (date === addDays(today, 1)) return 'Tomorrow';
  return fmtDate(`${date}T12:00:00`);
};

/** One tickable occurrence, and optionally startable as a timed session. */
function OccurrenceRow({
  occ,
  today,
  busy,
  ticked,
  leaves,
  onToggle,
  onStart,
}: {
  occ: RoutineOccurrence;
  today: string;
  busy: boolean;
  /** Just ticked here: play the tick, and draw it done before the server answers. */
  ticked: boolean;
  /** In a due list, where a ticked row folds away rather than staying. */
  leaves?: boolean;
  onToggle: (from: HTMLElement) => void;
  onStart?: () => void;
}) {
  const future = occ.date > today;
  const done = occ.done || ticked;
  const state = `${done ? ' is-done' : ''}${ticked ? ' is-ticked' : ''}${ticked && leaves ? ' is-leaving' : ''}`;
  return (
    <li className={`routine-row${state}`}>
      <button
        type="button"
        className="routine-tick"
        role="checkbox"
        aria-checked={done}
        aria-label={`${done ? 'Untick' : 'Tick off'} ${occ.title} for ${occ.date}`}
        disabled={future || busy}
        onClick={(e) => onToggle(e.currentTarget)}
      >
        <Check size={14} aria-hidden />
      </button>
      <span className="flex-1 min-w-0 truncate">
        <span className="routine-title">{occ.title}</span>
      </span>
      {occ.overdue && <Chip tone="warn">missed</Chip>}
      <span className="muted text-sm tabular">{occ.estimatedMinutes}m</span>
      {onStart && !done && !future && (
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label={`Start a session for ${occ.title}`}
          title="Start a session"
          onClick={onStart}
        >
          <Play size={14} aria-hidden />
        </Button>
      )}
    </li>
  );
}

export function Routines() {
  const [weekOffset, setWeekOffset] = useState(0);
  const q = useRoutines();
  const nodes = useNodes();
  const active = useActiveSession();
  const create = useCreateRoutine();
  const update = useUpdateRoutine();
  const remove = useDeleteRoutine();
  const tick = useTickRoutine();
  const untick = useUntickRoutine();
  const importIcs = useImportRoutineIcs();
  const { toast } = useToast();

  const [dialog, setDialog] = useState<{ open: boolean; routine: Routine | null }>({
    open: false,
    routine: null,
  });
  const [importing, setImporting] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [startFor, setStartFor] = useState<RoutineOccurrence | null>(null);
  const dueNow = useTickedRoutines(q.data?.due ?? []);

  if (q.isError)
    return (
      <ErrorPanel
        message={q.error instanceof Error ? q.error.message : 'Could not load your routines.'}
        onRetry={() => q.refetch()}
      />
    );
  if (!q.data)
    return (
      <div className="flex justify-center p-12">
        <Spinner />
      </div>
    );

  const { today, routines, occurrences, adherence } = q.data;
  // One session at a time: while one runs, the rows only tick.
  const canStart = !active.data?.active;
  const nodeIndex = new Map((nodes.data?.nodes ?? []).map((n) => [n.id, n]));
  // "Biology › Unit 3 › Osmosis" for a linked node, so the routine's context is visible.
  const nodeTitle = (id: string) => {
    const n = nodeIndex.get(id);
    if (!n) return '';
    const parents = pathLabel(nodeIndex, id);
    return parents ? `${parents} › ${n.title}` : n.title;
  };
  const weekStart = addDays(startOfWeekMonday(today), weekOffset * 7);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const byDay = new Map<string, RoutineOccurrence[]>();
  for (const o of occurrences) {
    if (!byDay.has(o.date)) byDay.set(o.date, []);
    byDay.get(o.date)!.push(o);
  }

  const toggle = async (occ: RoutineOccurrence, from: HTMLElement) => {
    const key = occurrenceKey(occ);
    if (occ.done) {
      dueNow.release(occ);
      setBusyKey(key);
      try {
        await untick.mutateAsync({ id: occ.routineId, date: occ.date });
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Could not update that.');
      } finally {
        setBusyKey(null);
      }
      return;
    }
    // Ticked already and waiting on the refetch: the row shows done, so a second click is
    // not an untick yet.
    if (dueNow.ticked.has(key)) return;
    // No busy state: the tick plays straight away, and a dimmed box would spoil it.
    dueNow.tick(occ, from);
    try {
      const res = await tick.mutateAsync({ id: occ.routineId, date: occ.date });
      if (res.xpAwarded > 0) toast(`+${res.xpAwarded} XP`, { tone: 'ok' });
      announceAchievements(res.badges);
    } catch (err) {
      dueNow.release(occ);
      toast(err instanceof Error ? err.message : 'Could not update that.');
    }
  };

  const del = async (routine: Routine) => {
    if (!window.confirm(`Delete "${routine.title}" and all its ticks?`)) return;
    try {
      await remove.mutateAsync(routine.id);
      toast('Routine deleted', { tone: 'ok' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete that.');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <h1 className="text-3xl">Routines</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>
            <Upload size={15} aria-hidden /> Import .ics
          </Button>
          <Button size="sm" onClick={() => setDialog({ open: true, routine: null })}>
            <Plus size={15} aria-hidden /> New routine
          </Button>
        </div>
      </div>

      {routines.length === 0 ? (
        <Glass className="p-8 text-center flex flex-col items-center gap-3">
          <span aria-hidden style={{ color: 'var(--fg-subtle)' }}>
            <Repeat size={32} />
          </span>
          <h2 className="text-xl">The things that repeat</h2>
          <p className="muted" style={{ maxWidth: '46ch' }}>
            Daily reading, a weekly problem set, a monthly review. Give each one an estimate, then
            tick it off — or start it as a timed session and tick it off at the end.
          </p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => setDialog({ open: true, routine: null })}>
              Add your first
            </Button>
            <Button variant="secondary" onClick={() => setImporting(true)}>
              Import a calendar
            </Button>
          </div>
        </Glass>
      ) : (
        <>
          <Glass className="p-5 flex flex-col gap-3">
            <h2 className="text-lg">Due now</h2>
            {dueNow.rows.length === 0 ? (
              <p className="muted">Nothing outstanding. Everything due is ticked off.</p>
            ) : (
              <ul className="routine-list">
                {dueNow.rows.map((o) => (
                  <OccurrenceRow
                    key={occurrenceKey(o)}
                    occ={o}
                    today={today}
                    busy={busyKey === occurrenceKey(o)}
                    ticked={dueNow.ticked.has(occurrenceKey(o))}
                    leaves
                    onToggle={(from) => void toggle(o, from)}
                    onStart={canStart ? () => setStartFor(o) : undefined}
                  />
                ))}
              </ul>
            )}
            {adherence.rate !== null && (
              <div>
                <ProgressBar value={adherence.rate} label="Last four weeks" />
                {/* Inline: the shared `p { margin: 0 }` outranks Tailwind's layered utilities. */}
                <p className="subtle text-xs tabular" style={{ marginTop: 12 }}>
                  {adherence.done} of {adherence.due} ticked off over the last four weeks
                </p>
              </div>
            )}
          </Glass>

          <Panel className="p-5 flex flex-col gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-lg flex-1">Week of {fmtDate(`${weekStart}T12:00:00`)}</h2>
              <Button size="sm" variant="ghost" onClick={() => setWeekOffset(weekOffset - 1)}>
                Previous
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={weekOffset === 0}
                onClick={() => setWeekOffset(0)}
              >
                This week
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setWeekOffset(weekOffset + 1)}>
                Next
              </Button>
            </div>
            <div className="routine-week">
              {weekDays.map((d) => {
                const items = byDay.get(d) ?? [];
                return (
                  <div key={d} className={`routine-day${d === today ? ' is-today' : ''}`}>
                    <div className="routine-day-head">
                      <span className="font-medium text-sm">{DAY_LABEL(d, today)}</span>
                      {items.length > 0 && (
                        <span className="subtle text-xs tabular">
                          {items.filter((i) => i.done).length}/{items.length}
                        </span>
                      )}
                    </div>
                    {items.length === 0 ? (
                      <p className="subtle text-xs">—</p>
                    ) : (
                      <ul className="routine-list">
                        {items.map((o) => (
                          <OccurrenceRow
                            key={occurrenceKey(o)}
                            occ={o}
                            today={today}
                            busy={busyKey === occurrenceKey(o)}
                            ticked={dueNow.ticked.has(occurrenceKey(o))}
                            onToggle={(from) => void toggle(o, from)}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
            {weekOffset !== 0 && (
              <p className="subtle text-xs">
                Occurrences load for two weeks either side of today; navigate back to this week to
                tick anything off.
              </p>
            )}
          </Panel>

          <Panel className="p-5 flex flex-col gap-3">
            <h2 className="text-lg">All routines</h2>
            <ul className="flex flex-col">
              {routines.map((r) => (
                <li key={r.id} className="tree-row">
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{r.title}</div>
                    <div className="muted text-sm">
                      {describeRecurrence(r)} · {r.estimatedMinutes} min
                      {r.nodeId && nodeTitle(r.nodeId) && ` · ${nodeTitle(r.nodeId)}`}
                      {r.source === 'ics' && ' · from a calendar'}
                    </div>
                  </div>
                  <div className="row-actions flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon
                      aria-label={`Edit ${r.title}`}
                      onClick={() => setDialog({ open: true, routine: r })}
                    >
                      <Pencil size={15} aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon
                      aria-label={`Delete ${r.title}`}
                      onClick={() => void del(r)}
                    >
                      <Trash2 size={15} aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}

      <RoutineDialog
        key={dialog.routine?.id ?? 'new'}
        open={dialog.open}
        routine={dialog.routine}
        nodes={nodes.data?.nodes ?? []}
        today={today}
        onClose={() => setDialog({ open: false, routine: null })}
        onSave={async (input) => {
          if (dialog.routine) await update.mutateAsync({ id: dialog.routine.id, patch: input });
          else await create.mutateAsync(input);
          toast(dialog.routine ? 'Routine saved' : 'Routine added', { tone: 'ok' });
        }}
      />
      <StartSessionDialog
        open={startFor !== null}
        onClose={() => setStartFor(null)}
        nodes={nodes.data?.nodes ?? []}
        routine={startFor}
      />
      <IcsImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        onImport={(ics, defaultEstimate) => importIcs.mutateAsync({ ics, defaultEstimate })}
      />
    </div>
  );
}
