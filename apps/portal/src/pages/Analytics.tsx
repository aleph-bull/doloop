import { useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Bars,
  DataTable,
  LineChart,
  Panel,
  ProgressBar,
  Segmented,
  Spinner,
  StackedBars,
} from '@komogon/ui';
import { ErrorPanel } from '../components/ErrorState';
import { RecapView } from '../components/recap/RecapView';
import { StatusChip } from '../components/StatusChip';
import { fmtDate, fmtHours, fmtMinutes, pct } from '../lib/format';
import { useAdvancedAnalytics } from '../lib/queries';

/** Prose for a pace/planning line that would otherwise be a bare pair of numbers. */
function plannedVsNeeded(planned: number, needed: number | null): string {
  if (needed === null) return 'No estimate, so there is nothing to be behind on.';
  if (needed <= 0) return 'Nothing left to schedule.';
  if (planned >= needed) return 'You have scheduled enough time to finish this.';
  return `You are ${fmtMinutes(needed - planned)} short of the time you would need.`;
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
        <p className="muted text-sm">
          Where the time actually went. Each bar is one course split by its parts, so a course that
          looks busy but is all one topic shows up as a single wide band.
        </p>
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
            <p className="muted text-sm">
              Each bar is logged time divided by what you estimated, for one finished task. 1× means
              you called it exactly; above 1× means it took longer than you thought. Only finished
              tasks with an estimate appear here.
            </p>
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
            <p className="muted text-sm">
              {plannedVsNeeded(node.plannedMinutes, node.neededMinutes)}
              {node.distractionRate !== null &&
                ` You reported a distraction in ${Math.round(node.distractionRate * 100)}% of the sessions you answered for.`}
            </p>
            {node.preparedness.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-1">Preparedness over time</h3>
                <p className="muted text-sm mb-1">
                  How prepared you said you felt at the end of each session on this task, 1 to 5. It
                  is your own read, not a score.
                </p>
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
              columns={['When', 'Work', 'Break', 'Idle', 'Distracted']}
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
                ])}
            />
          </div>
        )}
      </Panel>
    </div>
  );
}

const TABS = ['week', 'month', 'all', 'advanced'] as const;
type Tab = (typeof TABS)[number];

export function Analytics() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  // "overview" was the All time tab's old name; links to it still land there.
  const named = raw === 'overview' ? 'all' : raw;
  const tab: Tab = (TABS as readonly string[]).includes(named ?? '') ? (named as Tab) : 'week';
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
            { value: 'month', label: 'This month' },
            { value: 'all', label: 'All time' },
            { value: 'advanced', label: 'By task' },
          ]}
        />
      </div>
      {tab === 'advanced' ? <Advanced /> : <RecapView range={tab} />}
    </div>
  );
}
