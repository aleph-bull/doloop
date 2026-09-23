import type { TrackerWidget as TrackerWidgetData } from '@komodoit/core';
import { Check, Minus, Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Heatmap, Input, Panel, useToast } from '@komodoit/ui';
import { useLogTracker } from '../lib/queries';

export interface TrackerWidgetProps {
  widget: TrackerWidgetData;
  /** Show only the most recent N columns. Defaults to the whole grid. */
  weeks?: number;
  onEdit: (widget: TrackerWidgetData) => void;
}

/** "12 pages", "1 page" - the unit label is the user's own word, pluralised naively. */
export function fmtAmount(amount: number, unitLabel: string): string {
  const n = Math.round(amount * 100) / 100;
  if (n === 1 && unitLabel.endsWith('s')) return `1 ${unitLabel.slice(0, -1)}`;
  return `${n} ${unitLabel}`;
}

/**
 * One tracker: its contribution grid, today's number, and the field to change it.
 *
 * The field writes the day's total rather than appending, so a mistyped entry is fixed by
 * typing the right number instead of logging a negative correction. The +/- buttons step
 * that same total.
 */
export function TrackerWidget({ widget, weeks, onEdit }: TrackerWidgetProps) {
  const { tracker, grid, todayAmount } = widget;
  const log = useLogTracker();
  const { toast } = useToast();
  const [draft, setDraft] = useState(String(todayAmount || ''));
  const [saved, setSaved] = useState(false);

  // Follow the server's value when it changes underneath us (another device, a refetch),
  // but never while the user is mid-edit.
  useEffect(() => {
    if (!log.isPending) setDraft(String(todayAmount || ''));
  }, [todayAmount, log.isPending]);

  const commit = (amount: number) => {
    if (!Number.isFinite(amount) || amount < 0) {
      toast('Enter a number of ' + tracker.unitLabel);
      return;
    }
    log.mutate(
      { id: tracker.id, input: { amount, mode: 'set' } },
      {
        onSuccess: () => {
          setSaved(true);
          window.setTimeout(() => setSaved(false), 1200);
        },
        onError: (e) => toast(e instanceof Error ? e.message : 'Could not log that'),
      },
    );
  };

  const step = (delta: number) => commit(Math.max(0, todayAmount + delta));
  const goalMet = tracker.dailyGoal !== null && todayAmount >= tracker.dailyGoal;

  return (
    <Panel as="section" className="p-4 flex flex-col gap-3" aria-labelledby={`tr-${tracker.id}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h3 id={`tr-${tracker.id}`} className="text-base font-semibold truncate">
            {tracker.title}
          </h3>
          <p className="muted text-xs tabular">
            {fmtAmount(grid.total, tracker.unitLabel)} over {grid.activeDays} day
            {grid.activeDays === 1 ? '' : 's'}
            {grid.currentRun >= 2 && ` · ${grid.currentRun} day run`}
            {tracker.dailyGoal !== null &&
              ` · goal ${fmtAmount(tracker.dailyGoal, tracker.unitLabel)}/day`}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label={`Edit ${tracker.title}`}
          onClick={() => onEdit(widget)}
        >
          <Pencil size={14} aria-hidden />
        </Button>
      </div>

      <Heatmap
        weeks={grid.weeks.slice(weeks ? Math.max(0, grid.weeks.length - weeks) : 0).map((week) =>
          week.map((c) => ({
            date: c.date,
            minutes: c.amount,
            level: c.level,
            future: c.future,
          })),
        )}
        monthLabels={grid.monthLabels
          .map((m) => ({
            ...m,
            column: m.column - (weeks ? Math.max(0, grid.weeks.length - weeks) : 0),
          }))
          .filter((m) => m.column >= 0)}
        thresholds={grid.thresholds}
        format={(v) => (v <= 0 ? `no ${tracker.unitLabel}` : fmtAmount(v, tracker.unitLabel))}
        compact
        ariaLabel={`${tracker.title} per day from ${grid.from} to ${grid.to}`}
      />

      <form
        className="flex items-end gap-2 flex-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          commit(Number(draft || '0'));
        }}
      >
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label={`One fewer ${tracker.unitLabel} today`}
          disabled={todayAmount <= 0 || log.isPending}
          onClick={() => step(-1)}
        >
          <Minus size={14} aria-hidden />
        </Button>
        <Input
          label={`Today (${tracker.unitLabel})`}
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          className="w-28"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label={`One more ${tracker.unitLabel} today`}
          disabled={log.isPending}
          onClick={() => step(1)}
        >
          <Plus size={14} aria-hidden />
        </Button>
        <Button type="submit" variant="secondary" size="sm" loading={log.isPending}>
          {saved ? (
            <>
              <Check size={14} aria-hidden /> Saved
            </>
          ) : (
            'Log'
          )}
        </Button>
        {goalMet && (
          <span className="text-xs" style={{ color: 'var(--accent)' }}>
            Goal met
          </span>
        )}
      </form>
    </Panel>
  );
}
