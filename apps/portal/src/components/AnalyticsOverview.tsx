import type { Insight, RhythmProfile } from '@doloop/core';
import { useState } from 'react';
import { Bars, DataTable, Glass, Heatmap, Panel, Segmented, Spinner } from '@doloop/ui';
import { ErrorPanel } from './ErrorState';
import { fmtDate, fmtHours } from '../lib/format';
import { useOverviewAnalytics } from '../lib/queries';

const TONE_LABEL: Record<Insight['tone'], string> = {
  good: 'Up',
  watch: 'Down',
  neutral: 'Steady',
};

/**
 * One insight: the claim, then the numbers it came from. The evidence line is not
 * decoration — it is how the reader checks the claim instead of trusting it.
 */
function InsightRow({ insight }: { insight: Insight }) {
  return (
    <li className="insight">
      <span className={`insight-dot insight-${insight.tone}`} aria-hidden />
      <div className="min-w-0">
        <p className="insight-headline">{insight.headline}</p>
        <p className="muted text-sm">{insight.evidence}</p>
      </div>
      <span className="sr-only">{TONE_LABEL[insight.tone]}</span>
    </li>
  );
}

function RhythmPanel({
  title,
  profile,
  takeaway,
}: {
  title: string;
  profile: RhythmProfile;
  takeaway: string;
}) {
  if (profile.totalMinutes <= 0) return null;
  return (
    <Panel className="p-5 flex flex-col gap-3">
      <h3 className="text-lg">{title}</h3>
      <Bars
        ariaLabel={title}
        bars={profile.buckets.map((b) => ({
          // The axis is cramped, so long band names are shortened to their first word.
          label: b.label.split(' ')[0] ?? b.label,
          value: b.minutes,
          highlight: b.label === profile.peak?.label,
        }))}
      />
      <p className="muted text-sm">{takeaway}</p>
      <DataTable
        caption={title}
        columns={['Band', 'Time', 'Share']}
        rows={profile.buckets.map((b) => [
          b.label,
          fmtHours(b.minutes),
          `${Math.round(b.share * 100)}%`,
        ])}
      />
    </Panel>
  );
}

/** The long view: everything that only means something once there is some history. */
export function AnalyticsOverview() {
  const [weeks, setWeeks] = useState(53);
  const q = useOverviewAnalytics(weeks);

  if (q.isError)
    return (
      <ErrorPanel
        message={q.error instanceof Error ? q.error.message : 'Could not load your history.'}
        onRetry={() => q.refetch()}
      />
    );
  if (!q.data)
    return (
      <div className="flex justify-center p-12">
        <Spinner />
      </div>
    );

  const { lifetime, heatmap, timeOfDay, weekday, insights } = q.data;

  if (lifetime.totalSessions === 0)
    return (
      <Glass className="p-8 text-center flex flex-col items-center gap-2">
        <h2 className="text-xl">Nothing to look back on yet</h2>
        <p className="muted" style={{ maxWidth: '44ch' }}>
          Once you have finished a few sessions this page fills in: total hours, the days you
          studied, and when you do your best work.
        </p>
      </Glass>
    );

  return (
    <div className="flex flex-col gap-6">
      <Glass className="p-6 flex flex-col gap-4">
        <p className="text-2xl leading-snug">{lifetime.headline}</p>
        <dl className="stat-row">
          <div>
            <dt>Total</dt>
            <dd className="tabular">{fmtHours(lifetime.totalMinutes)}</dd>
          </div>
          <div>
            <dt>Sessions</dt>
            <dd className="tabular">{lifetime.totalSessions}</dd>
          </div>
          <div>
            <dt>Days studied</dt>
            <dd className="tabular">{lifetime.activeDays}</dd>
          </div>
          <div>
            <dt>Typical study day</dt>
            <dd className="tabular">{fmtHours(lifetime.avgMinutesPerActiveDay)}</dd>
          </div>
          <div>
            <dt>Longest session</dt>
            <dd className="tabular">{fmtHours(lifetime.longestSessionMinutes)}</dd>
          </div>
        </dl>
        <p className="subtle text-sm">
          Counting from {fmtDate(`${lifetime.since}T12:00:00`)}, when you started using Doloop.
          &ldquo;Typical study day&rdquo; averages the days you actually studied, not every day on
          the calendar.
        </p>
      </Glass>

      <Panel className="p-5 flex flex-col gap-3">
        <div className="flex items-end gap-3 flex-wrap">
          <h3 className="text-lg flex-1">Days you studied</h3>
          <Segmented
            ariaLabel="Heatmap range"
            value={String(weeks)}
            onChange={(v) => setWeeks(Number(v))}
            options={[
              { value: '13', label: '3 months' },
              { value: '27', label: '6 months' },
              { value: '53', label: 'Year' },
            ]}
          />
        </div>
        <Heatmap
          weeks={heatmap.weeks}
          monthLabels={heatmap.monthLabels}
          thresholds={heatmap.thresholds}
          ariaLabel={`Study minutes per day from ${heatmap.from} to ${heatmap.to}`}
        />
        <p className="muted text-sm">
          {fmtHours(heatmap.totalMinutes)} across {heatmap.activeDays} day
          {heatmap.activeDays === 1 ? '' : 's'} in this window
          {heatmap.longestRun >= 2 && `, with a longest run of ${heatmap.longestRun} days`}. Shading
          is relative to your own days, so a darker square means a heavier day for you — not a fixed
          number of hours.
        </p>
      </Panel>

      {insights.length > 0 && (
        <Panel className="p-5 flex flex-col gap-3">
          <h3 className="text-lg">What the numbers say</h3>
          <ul className="insight-list">
            {insights.map((i) => (
              <InsightRow key={i.key} insight={i} />
            ))}
          </ul>
          <p className="subtle text-xs">
            Descriptions of what you have done, not targets. Each line shows the figures it came
            from.
          </p>
        </Panel>
      )}

      <div className="two-col">
        <RhythmPanel
          title="When you work"
          profile={timeOfDay}
          takeaway={
            timeOfDay.peak
              ? `Your fullest stretch is the ${timeOfDay.peak.label.toLowerCase()} band, at ${Math.round(
                  timeOfDay.peak.share * 100,
                )}% of your logged minutes. Bands are counted by the hour a session starts.`
              : 'Not enough history yet.'
          }
        />
        <RhythmPanel
          title="Which days"
          profile={weekday}
          takeaway={
            weekday.peak
              ? `${weekday.peak.label} carries the most, at ${Math.round(
                  weekday.peak.share * 100,
                )}% of your logged minutes.`
              : 'Not enough history yet.'
          }
        />
      </div>
    </div>
  );
}
