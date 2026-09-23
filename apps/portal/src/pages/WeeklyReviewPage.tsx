import { addDays } from '@komodoit/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { Bars, Button, Glass, Panel, Spinner, Textarea, useToast } from '@komodoit/ui';
import { ErrorPanel } from '../components/ErrorState';
import { fmtDate, fmtHours } from '../lib/format';
import { useLocalDraft } from '../lib/local-state';
import { useSaveWeeklyNote, useWeeklyReview } from '../lib/queries';

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Auto-generated weekly review (spec §11b), viewable anytime, with one saved prompt. */
export function WeeklyReviewPage() {
  const [weekStart, setWeekStart] = useState<string | undefined>(undefined);
  const q = useWeeklyReview(weekStart);
  const save = useSaveWeeklyNote();
  const { toast } = useToast();
  // Kept in this browser, so a half-written note survives a reload or a refetch.
  const [note, setNote, clearNoteDraft] = useLocalDraft(
    `weekly-review.${q.data?.review.weekStart ?? weekStart ?? 'current'}`,
    q.data?.note ?? '',
  );

  if (q.isError)
    return (
      <ErrorPanel
        message={q.error instanceof Error ? q.error.message : 'Could not load the review.'}
        onRetry={() => q.refetch()}
      />
    );
  if (!q.data)
    return (
      <div className="flex justify-center p-12">
        <Spinner />
      </div>
    );
  const r = q.data.review;
  const kept = r.plannedMinutes > 0 ? Math.min(1, r.actualMinutes / r.plannedMinutes) : null;

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <Link to="/analytics" className="text-sm">
            Analytics
          </Link>
          <h1 className="text-3xl">Weekly review</h1>
          <p className="muted text-sm mt-1">
            {fmtDate(`${r.weekStart}T12:00:00`)} to {fmtDate(`${r.weekEnd}T12:00:00`)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setWeekStart(addDays(r.weekStart, -7))}>
            Previous week
          </Button>
          <Button size="sm" onClick={() => setWeekStart(addDays(r.weekStart, 7))}>
            Next week
          </Button>
        </div>
      </div>

      <div className="card-grid">
        <Glass className="p-5">
          <div className="subtle text-sm">Actual vs planned</div>
          <div className="text-2xl tabular mt-1">
            {fmtHours(r.actualMinutes)}{' '}
            <span className="muted text-base">of {fmtHours(r.plannedMinutes)} planned</span>
          </div>
          <p className="muted text-sm mt-1">
            {kept === null
              ? 'No planned blocks this week.'
              : `${Math.round(kept * 100)}% of planned time studied, across ${r.sessions} session${r.sessions === 1 ? '' : 's'}.`}
          </p>
        </Glass>
        <Glass className="p-5">
          <div className="subtle text-sm">Streak</div>
          <div className="text-2xl tabular mt-1">{r.streak.current} days</div>
          <p className="muted text-sm mt-1">
            Longest {r.streak.longest}.{' '}
            {r.freezesUsed > 0
              ? `${r.freezesUsed} freeze${r.freezesUsed === 1 ? '' : 's'} used this week.`
              : 'No freezes used this week.'}{' '}
            {r.streak.freezesHeld} held.
          </p>
        </Glass>
      </div>

      <Panel className="p-5 flex flex-col gap-3">
        <h2 className="text-lg">Hours by day</h2>
        <Bars
          ariaLabel="Study minutes per day this week"
          bars={r.hoursByDay.map((d, i) => ({ label: DAY[i] ?? d.date, value: d.minutes }))}
        />
      </Panel>

      <Panel className="p-5 flex flex-col gap-2 text-sm">
        <h2 className="text-lg">Notes</h2>
        {r.topDistractionDays.length > 0 ? (
          <p>
            Most distracted:{' '}
            {r.topDistractionDays
              .map((d) => `${fmtDate(`${d.date}T12:00:00`)} (${d.count})`)
              .join(', ')}
            .
          </p>
        ) : (
          <p className="muted">No sessions reported heavy distraction.</p>
        )}
        {r.restDayEditsThisMonth > 0 && (
          <p className="muted">
            Rest days changed {r.restDayEditsThisMonth} time
            {r.restDayEditsThisMonth === 1 ? '' : 's'} this month.
          </p>
        )}
      </Panel>

      <Panel className="p-5 flex flex-col gap-3">
        <h2 className="text-lg">What should change next week?</h2>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="One concrete thing."
        />
        <div>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() =>
              save
                .mutateAsync({ weekStart: r.weekStart, note })
                .then(() => {
                  clearNoteDraft();
                  toast('Saved', { tone: 'ok' });
                })
                .catch((e) => toast(e.message))
            }
          >
            Save
          </Button>
        </div>
      </Panel>
    </div>
  );
}
