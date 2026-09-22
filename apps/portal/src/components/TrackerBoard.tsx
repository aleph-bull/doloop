import { weeksForHistory, type Tracker } from '@doloop/core';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Button, Heatmap, Panel, Segmented, Spinner } from '@doloop/ui';
import { TrackerDialog } from './TrackerDialog';
import { TrackerWidget } from './TrackerWidget';
import { fmtHours } from '../lib/format';
import { useOverviewAnalytics, useTrackers } from '../lib/queries';

type Range = 'auto' | 13 | 27 | 53;

/**
 * The contribution grids: days focused, then anything the user has decided to count.
 *
 * The range defaults to `auto`, which sizes the grid to how much history there is. A year
 * of empty squares on someone's second day is a wall of nothing; the grid grows with them,
 * and the fixed ranges are there once there is something to look back on.
 */
export function TrackerBoard() {
  const [range, setRange] = useState<Range>('auto');
  // The overview is always requested at full width; the grid is narrowed afterwards, so
  // changing the range never costs a round trip.
  const overview = useOverviewAnalytics(53);
  const trackers = useTrackers(53);
  const [dialog, setDialog] = useState<{ tracker: Tracker | null } | null>(null);

  if (overview.isLoading || trackers.isLoading) {
    return (
      <div className="flex justify-center p-6">
        <Spinner />
      </div>
    );
  }

  const heatmap = overview.data?.heatmap;
  const widgets = trackers.data?.widgets ?? [];

  // The first day anything was logged, across study and every tracker.
  const firstActivity =
    [
      heatmap?.weeks.flat().find((c) => c.minutes > 0)?.date,
      ...widgets.map((w) => w.grid.weeks.flat().find((c) => c.amount > 0)?.date),
    ]
      .filter((d): d is string => !!d)
      .sort()[0] ?? null;

  const today = heatmap?.to ?? new Date().toISOString().slice(0, 10);
  const weeks = range === 'auto' ? weeksForHistory(firstActivity, today) : range;
  const trim = <T,>(cols: T[]): T[] => cols.slice(Math.max(0, cols.length - weeks));
  const shiftLabels = (labels: Array<{ column: number; label: string }>, total: number) =>
    labels
      .map((m) => ({ ...m, column: m.column - Math.max(0, total - weeks) }))
      .filter((m) => m.column >= 0);

  return (
    <section className="flex flex-col gap-4" aria-label="Your grids">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-lg">Days focused</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <Segmented
            ariaLabel="Range"
            value={String(range)}
            onChange={(v) => setRange(v === 'auto' ? 'auto' : (Number(v) as Range))}
            options={[
              { value: 'auto', label: 'So far' },
              { value: '13', label: '3 months' },
              { value: '27', label: '6 months' },
              { value: '53', label: 'Year' },
            ]}
          />
          <Button size="sm" onClick={() => setDialog({ tracker: null })}>
            <Plus size={14} aria-hidden /> Tracker
          </Button>
        </div>
      </div>

      {heatmap && (
        <Panel className="p-5 flex flex-col gap-2">
          <Heatmap
            weeks={trim(heatmap.weeks)}
            monthLabels={shiftLabels(heatmap.monthLabels, heatmap.weeks.length)}
            thresholds={heatmap.thresholds}
            ariaLabel={`Study minutes per day, ${weeks} weeks to ${heatmap.to}`}
          />
          <p className="muted text-sm">
            {fmtHours(heatmap.totalMinutes)} across {heatmap.activeDays} day
            {heatmap.activeDays === 1 ? '' : 's'}
            {heatmap.longestRun >= 2 && `, longest run ${heatmap.longestRun} days`}.
          </p>
        </Panel>
      )}

      {widgets.length > 0 && (
        <div className="tracker-grid">
          {widgets.map((w) => (
            <TrackerWidget
              key={w.tracker.id}
              widget={w}
              weeks={weeks}
              onEdit={(x) => setDialog({ tracker: x.tracker })}
            />
          ))}
        </div>
      )}

      <TrackerDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        tracker={dialog?.tracker ?? null}
      />
    </section>
  );
}
