import type { Highlight } from '@doloop/core';
import { splitHighlights } from '@doloop/core';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Bars,
  DataTable,
  Glass,
  LineChart,
  Panel,
  ProgressBar,
  Segmented,
  Spinner,
  StackedBars,
} from '@doloop/ui';
import { ErrorPanel } from '../components/ErrorState';
import { StatusChip } from '../components/StatusChip';
import { fmtDate, fmtHours, fmtMinutes, pct } from '../lib/format';
import { useAdvancedAnalytics, useWeekHighlights } from '../lib/queries';

function HighlightCard({ h }: { h: Highlight }) {
  return (
    <Glass as="article" className="p-5 flex flex-col gap-1">
      <h3 className="text-lg leading-snug">{h.headline}</h3>
      <p className="muted text-sm">{h.detail}</p>
    </Glass>
  );
}

/** "This week": positive signals only (spec §11a). */
function ThisWeek() {
  const q = useWeekHighlights();
  const [more, setMore] = useState(false);
  if (q.isError)
    return (
      <ErrorPanel
        message={q.error instanceof Error ? q.error.message : 'Could not load highlights.'}
        onRetry={() => q.refetch()}
      />
    );
  if (!q.data)
    return (
      <div className="flex justify-center p-12">
        <Spinner />
      </div>
    );
  const { top, more: rest } = splitHighlights(q.data.highlights);
  return (
    <div className="flex flex-col gap-4">
      <p className="muted text-sm">
        Week of {fmtDate(`${q.data.weekStart}T12:00:00`)} to {fmtDate(`${q.data.weekEnd}T12:00:00`)}
      </p>
      {q.data.fallback ? (
        <Glass className="p-6">
          <p className="text-lg">{q.data.fallback}</p>
        </Glass>
      ) : (
        <>
          <div className="card-grid">
            {top.map((h) => (
              <HighlightCard key={h.key} h={h} />
            ))}
          </div>
          {rest.length > 0 && (
            <div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-expanded={more}
                onClick={() => setMore(!more)}
              >
                {more ? 'Fewer' : `More wins (${rest.length})`}
              </button>
              {more && (
                <div className="card-grid mt-3">
                  {rest.map((h) => (
                    <HighlightCard key={h.key} h={h} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
      <Link to="/analytics/review" className="text-sm">
        Weekly review
      </Link>
    </div>
  );
}

/** "Advanced": everything, neutrally (spec §11b). */
function Advanced() {
  const q = useAdvancedAnalytics();
  const [selected, setSelected] = useState<string | null>(null);
  if (q.isError)
    return (
      <ErrorPanel
        message={q.error instanceof Error ? q.error.message : 'Could not load analytics.'}
        onRetry={() => q.refetch()}
      />
    );
  if (!q.data)
    return (
      <div className="flex justify-center p-12">
        <Spinner />
      </div>
    );
  const { nodes, courses, estimateAccuracy } = q.data;
  const node = nodes.find((n) => n.nodeId === selected) ?? nodes[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <Panel className="p-5 flex flex-col gap-4">
        <h2 className="text-lg">Hours by course, this week vs last</h2>
        {courses.length === 0 && <p className="muted text-sm">No courses yet.</p>}
        {courses.map((c) => {
          const series = c.children.map((k) => k.title).slice(0, 5);
          const toRow = (label: string, key: 'thisWeek' | 'lastWeek') => ({
            label,
            segments: c.children.map((k) => ({
              name: series.includes(k.title) ? k.title : 'Other',
              value: k[key],
            })),
          });
          return (
            <div key={c.courseId} className="flex flex-col gap-2">
              <h3 className="font-medium">
                {c.title}{' '}
                <span className="muted text-sm tabular">
                  {fmtHours(c.thisWeekTotal)} this week, {fmtHours(c.lastWeekTotal)} last week
                </span>
              </h3>
              {c.thisWeekTotal + c.lastWeekTotal > 0 ? (
                <StackedBars
                  ariaLabel={`Hours by child for ${c.title}`}
                  series={[...series, ...(c.children.length > 5 ? ['Other'] : [])]}
                  rows={[toRow('This week', 'thisWeek'), toRow('Last week', 'lastWeek')]}
                />
              ) : (
                <p className="muted text-sm">No sessions in either week.</p>
              )}
            </div>
          );
        })}
      </Panel>

      <Panel className="p-5 flex flex-col gap-3">
        <h2 className="text-lg">Estimate accuracy</h2>
        {estimateAccuracy.insight ? (
          <p>{estimateAccuracy.insight}</p>
        ) : (
          <p className="muted text-sm">
            Complete a few estimated tasks to see how your estimates compare with reality.
          </p>
        )}
        {estimateAccuracy.samples.length > 0 && (
          <>
            <Bars
              ariaLabel="Logged divided by estimated, per completed task"
              unit="×"
              bars={estimateAccuracy.samples.slice(-12).map((s) => ({
                label: s.title.length > 10 ? `${s.title.slice(0, 9)}…` : s.title,
                value: Math.round(s.ratio * 100) / 100,
                highlight: s.ratio > 1.1,
              }))}
            />
            <DataTable
              caption="Estimate accuracy per task"
              columns={['Task', 'Kind', 'Logged / estimated']}
              rows={estimateAccuracy.samples.map((s) => [
                s.title,
                s.kind,
                `${Math.round(s.ratio * 100)}%`,
              ])}
            />
          </>
        )}
      </Panel>

      <Panel className="p-5 flex flex-col gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-lg flex-1">Per task</h2>
          {nodes.length > 0 && (
            <select
              className="select"
              style={{ width: 'auto', minWidth: 200 }}
              value={node?.nodeId ?? ''}
              onChange={(e) => setSelected(e.target.value)}
              aria-label="Task"
            >
              {nodes.map((n) => (
                <option key={n.nodeId} value={n.nodeId}>
                  {n.title}
                </option>
              ))}
            </select>
          )}
        </div>
        {!node ? (
          <p className="muted text-sm">No tasks yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              {node.pace && <StatusChip status={node.pace.status} />}
              {node.pace?.estimatedMinutes != null && (
                <span className="text-sm tabular muted">
                  {fmtMinutes(node.pace.loggedWorkMinutes)} logged of{' '}
                  {fmtMinutes(node.pace.estimatedMinutes)} ({pct(node.pace.rawProgress)})
                </span>
              )}
              <span className="text-sm tabular muted">
                Planned {fmtMinutes(node.plannedMinutes)} / need {fmtMinutes(node.neededMinutes)}
              </span>
              {node.distractionRate !== null && (
                <span className="text-sm tabular muted">
                  Distracted in {Math.round(node.distractionRate * 100)}% of sessions
                </span>
              )}
              {node.outcomeRating !== null && (
                <span className="text-sm muted">Went {node.outcomeRating}/5</span>
              )}
            </div>
            {node.pace?.progress != null && (
              <ProgressBar value={node.pace.progress} label={`${node.title} progress`} />
            )}
            {node.preparedness.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-1">Preparedness over time</h3>
                <LineChart
                  ariaLabel={`Preparedness ratings for ${node.title}`}
                  min={1}
                  max={5}
                  points={node.preparedness.map((p) => ({ x: fmtDate(p.at), y: p.value }))}
                />
              </div>
            )}
            <DataTable
              caption={`Sessions on ${node.title}`}
              columns={['When', 'Work', 'Break', 'Idle', 'Distracted', 'XP']}
              rows={node.sessions
                .slice(0, 30)
                .map((s) => [
                  `${fmtDate(s.startedAt)} ${new Date(s.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
                  fmtMinutes(s.workSeconds / 60),
                  fmtMinutes(s.breakSeconds / 60),
                  fmtMinutes(s.idleSeconds / 60),
                  s.review && !s.review.skipped && s.review.distracted
                    ? s.review.distracted.replace('-', ' ')
                    : '–',
                  s.xpAwarded,
                ])}
            />
          </div>
        )}
      </Panel>
    </div>
  );
}

export function Analytics() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'advanced' ? 'advanced' : 'week';
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <h1 className="text-3xl">Analytics</h1>
        <Segmented
          ariaLabel="Analytics view"
          value={tab}
          onChange={(v) => setParams(v === 'week' ? {} : { tab: v })}
          options={[
            { value: 'week', label: 'This week' },
            { value: 'advanced', label: 'Advanced' },
          ]}
        />
      </div>
      {tab === 'week' ? <ThisWeek /> : <Advanced />}
    </div>
  );
}
