import '../components/plans/plans.css';
import type { StudyNode, TopicProgress } from '@komogon/core';
import { roundAccuracy, startOfWeekMonday } from '@komogon/core';
import {
  ArrowLeft,
  Check,
  Crosshair,
  ExternalLink,
  Flame,
  Minus,
  Pencil,
  Play,
  Plus,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Button,
  Glass,
  Input,
  Modal,
  Panel,
  ProgressBar,
  Sparkline,
  Spinner,
  Textarea,
  fireConfetti,
  useToast,
} from '@komogon/ui';
import { ErrorPanel } from '../components/ErrorState';
import { StartSessionDialog } from '../components/StartSessionDialog';
import { DrillDialog } from '../components/plans/DrillDialog';
import { PlanStatus } from '../components/plans/PlanStatus';
import { TopicDialog } from '../components/plans/TopicDialog';
import type { DrillOutcome, PlanView } from '../lib/api';
import { fmtDate, fmtHours, pct } from '../lib/format';
import {
  useAddTopic,
  useAnswerItem,
  useDeleteItem,
  useDeletePlan,
  useDeleteTopic,
  useLogDrill,
  useMe,
  useNodes,
  usePlan,
  useUpdatePlan,
  useUpdateTopic,
} from '../lib/queries';

const day = (d: string, opts?: Intl.DateTimeFormatOptions) => fmtDate(`${d}T12:00:00`, opts);

const STATE_LABEL: Record<TopicProgress['state'], string> = {
  'up-next': 'Up next',
  'not-started': 'Not started',
  'in-progress': 'Studying',
  drilling: 'Drilling',
  mastered: 'Learned',
};

/** A resource that is a link opens; anything else is shown as written. */
function Resource({ value }: { value: string }) {
  if (/^https?:\/\//i.test(value)) {
    let host = value;
    try {
      host = new URL(value).hostname.replace(/^www\./, '');
    } catch {
      /* shown as written */
    }
    return (
      <a href={value} target="_blank" rel="noreferrer" className="plan-resource">
        {host} <ExternalLink size={12} aria-hidden />
      </a>
    );
  }
  return <span className="plan-resource">{value}</span>;
}

export function Plan() {
  const { id } = useParams<{ id: string }>();
  const q = usePlan(id);
  const nodes = useNodes();
  const me = useMe();
  const navigate = useNavigate();
  const { toast } = useToast();

  const updatePlan = useUpdatePlan();
  const deletePlan = useDeletePlan();
  const addTopic = useAddTopic();
  const updateTopic = useUpdateTopic();
  const deleteTopic = useDeleteTopic();
  const logDrill = useLogDrill();
  const answer = useAnswerItem();
  const deleteItem = useDeleteItem();

  const [startFor, setStartFor] = useState<StudyNode | null>(null);
  const [drillFor, setDrillFor] = useState<TopicProgress | null>(null);
  const [editTopic, setEditTopic] = useState<{ open: boolean; topic: TopicProgress | null }>({
    open: false,
    topic: null,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (q.isError)
    return (
      <ErrorPanel
        message={q.error instanceof Error ? q.error.message : 'Could not load that plan.'}
        onRetry={() => q.refetch()}
      />
    );
  if (!q.data)
    return (
      <div className="flex justify-center p-12">
        <Spinner />
      </div>
    );

  const v = q.data;
  const { plan, pacing } = v;
  const nodeById = new Map((nodes.data?.nodes ?? []).map((n) => [n.id, n]));
  const upNext = v.topics.find((t) => t.state !== 'mastered') ?? null;
  const confetti = me.data?.user.settings.effects.confetti ?? true;

  const celebrate = (res: DrillOutcome) => {
    if (!res.mastered) return;
    toast(`${res.mastered.title}: learned.`, { tone: 'ok' });
    if (confetti) fireConfetti();
  };

  const fail = (err: unknown, fallback: string) =>
    toast(err instanceof Error ? err.message : fallback);

  const weekShare = pacing.weeklyMinutes ? pacing.thisWeekMinutes / pacing.weeklyMinutes : 0;
  const lastWeek = v.weeks.length > 1 ? v.weeks[v.weeks.length - 2]! : null;
  const accuracyTrend = v.weeks.map((w) => w.accuracy).filter((a): a is number => a !== null);

  return (
    <div className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <Link to="/plans" className="plan-back">
            <ArrowLeft size={14} aria-hidden /> Plans
          </Link>
          <h1 className="page-title">{plan.title}</h1>
          <p className="page-sub">
            Week {pacing.week}
            {pacing.weeksTotal ? ` of ${pacing.weeksTotal}` : ''}
            {plan.targetDate ? ` · aiming for ${day(plan.targetDate, { weekday: 'short' })}` : ''}
            {` · ${fmtHours(plan.weeklyMinutes)} a week`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setSettingsOpen(true)}>
            <Pencil size={14} aria-hidden /> Edit plan
          </Button>
        </div>
      </div>

      {/* The hero: this week against the budget, the whole plan against its hours. */}
      <Glass as="section" className="plan-hero" aria-label="Progress">
        <div className="plan-hero-week">
          <span className="dash-label">This week</span>
          <span className="dash-hero-figure">
            {fmtHours(pacing.thisWeekMinutes)}
            <small> of {fmtHours(pacing.weeklyMinutes)}</small>
          </span>
          <ProgressBar value={weekShare} label="This week against the weekly budget" />
          {lastWeek && lastWeek.minutes > 0 && (
            <span className="muted text-sm">Last week {fmtHours(lastWeek.minutes)}</span>
          )}
        </div>
        <dl className="plan-hero-stats">
          <div>
            <dt className="dash-label">Logged</dt>
            <dd className="plan-stat tabular">
              {fmtHours(v.totals.minutes)}
              <small> of {fmtHours(pacing.plannedMinutes)}</small>
            </dd>
          </div>
          <div>
            <dt className="dash-label">Learned</dt>
            <dd className="plan-stat tabular">
              {pacing.topicsDone}
              <small> of {pacing.topicsTotal}</small>
            </dd>
          </div>
          {v.totals.accuracy !== null && (
            <div>
              <dt className="dash-label">Drill accuracy</dt>
              <dd className="plan-stat tabular">{pct(v.totals.accuracy)}</dd>
            </div>
          )}
          {v.streak > 0 && (
            <div>
              <dt className="dash-label">Streak</dt>
              <dd className="plan-stat tabular plan-streak">
                <Flame size={20} aria-hidden /> {v.streak}
                <small> day{v.streak === 1 ? '' : 's'}</small>
              </dd>
            </div>
          )}
        </dl>
        <div className="plan-hero-pace">
          <PlanStatus status={pacing.status} />
          <span className="text-sm">
            {pacing.status === 'done'
              ? 'Every topic learned. Nicely done.'
              : pacing.projectedFinish
                ? `At ${fmtHours(plan.weeklyMinutes)} a week, it lands ${day(pacing.projectedFinish, { weekday: 'short' })}.`
                : null}
          </span>
          {(v.rebalance.raiseWeeklyTo || v.rebalance.moveTargetTo) && (
            <span className="plan-rebalance">
              {v.rebalance.raiseWeeklyTo && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={updatePlan.isPending}
                  onClick={() =>
                    updatePlan
                      .mutateAsync({
                        id: plan.id,
                        patch: { weeklyMinutes: v.rebalance.raiseWeeklyTo! },
                      })
                      .catch((e) => fail(e, 'Could not change that.'))
                  }
                >
                  Make it {fmtHours(v.rebalance.raiseWeeklyTo)} a week
                </Button>
              )}
              {v.rebalance.moveTargetTo && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={updatePlan.isPending}
                  onClick={() =>
                    updatePlan
                      .mutateAsync({ id: plan.id, patch: { targetDate: v.rebalance.moveTargetTo } })
                      .catch((e) => fail(e, 'Could not change that.'))
                  }
                >
                  Move the target to {day(v.rebalance.moveTargetTo)}
                </Button>
              )}
            </span>
          )}
        </div>
      </Glass>

      <div className="dash-pair">
        {/* Today: the next topic, and the misses due back. */}
        <Panel as="section" className="plan-today" aria-label="Today">
          <h2 className="section-title">Today</h2>
          {upNext ? (
            <div className="plan-next">
              <div className="plan-next-text">
                <span className="dash-label">
                  {upNext.state === 'up-next' ? 'Up next' : 'Carry on with'}
                </span>
                <span className="plan-next-title">{upNext.topic.title}</span>
                <span className="muted text-sm">
                  {fmtHours(upNext.loggedMinutes)} of {fmtHours(upNext.topic.plannedMinutes)}
                  {upNext.accuracy !== null && ` · ${pct(upNext.accuracy)} on recent drills`}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={!nodeById.get(upNext.topic.id)}
                  onClick={() => setStartFor(nodeById.get(upNext.topic.id) ?? null)}
                >
                  <Play size={14} aria-hidden /> Start
                </Button>
                {upNext.topic.practice && (
                  <Button size="sm" variant="secondary" onClick={() => setDrillFor(upNext)}>
                    <Crosshair size={14} aria-hidden /> Drill
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className="muted">Every topic is learned. Drills still welcome.</p>
          )}

          <div className="plan-queue">
            <div className="section-head">
              <h3 className="plan-sub-title">Due back</h3>
              {v.laterCount > 0 && (
                <span className="muted text-sm">{v.laterCount} queued for later</span>
              )}
            </div>
            {v.queue.length === 0 ? (
              <p className="muted text-sm">
                {v.laterCount > 0
                  ? 'Nothing due today. Misses come back the day after.'
                  : 'Name a miss when you log a drill and it comes back here the next day.'}
              </p>
            ) : (
              <ul className="plan-queue-list">
                {v.queue.map((item) => (
                  <li key={item.id} className="plan-queue-item">
                    <div className="plan-queue-text">
                      <span>{item.prompt}</span>
                      <span className="muted text-sm">{item.topicTitle}</span>
                    </div>
                    <div className="plan-queue-actions">
                      {(
                        [
                          ['ok', 'Got it', Check],
                          ['shaky', 'Shaky', Minus],
                          ['miss', 'Missed again', X],
                        ] as const
                      ).map(([result, label, Icon]) => (
                        <Button
                          key={result}
                          size="sm"
                          variant="ghost"
                          icon
                          className={`drill-answer is-${result}`}
                          aria-label={`${label}: ${item.prompt}`}
                          title={label}
                          disabled={answer.isPending}
                          onClick={() =>
                            answer
                              .mutateAsync({ id: item.id, result })
                              .then(celebrate)
                              .catch((e) => fail(e, 'Could not save that.'))
                          }
                        >
                          <Icon size={15} aria-hidden />
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant="ghost"
                        icon
                        aria-label={`Drop ${item.prompt} from the queue`}
                        title="Drop it"
                        onClick={() =>
                          deleteItem
                            .mutateAsync(item.id)
                            .catch((e) => fail(e, 'Could not drop that.'))
                        }
                      >
                        <Trash2 size={14} aria-hidden />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {v.maintenance && (
            <p className="muted text-sm">
              Daily top-up: {v.maintenance.title}, {v.maintenance.estimatedMinutes} min. It sits
              with your <Link to="/routines">routines</Link>.
            </p>
          )}
        </Panel>

        {/* The recap: weeks as columns, accuracy as a line. */}
        <Panel as="section" className="plan-recap" aria-label="Recap">
          <h2 className="section-title">Week by week</h2>
          <ol className="plan-weeks" aria-label="Hours per week">
            {v.weeks.map((w) => {
              const max = Math.max(plan.weeklyMinutes, ...v.weeks.map((x) => x.minutes), 1);
              const current = w.weekStart === startOfWeekMonday(v.today);
              return (
                <li key={w.weekStart} className={`plan-week${current ? ' is-current' : ''}`}>
                  <span className="plan-week-value tabular">
                    {w.minutes > 0 ? fmtHours(w.minutes) : ''}
                  </span>
                  <span className="plan-week-track">
                    <span
                      className="plan-week-bar"
                      style={{ height: `${Math.min(100, (w.minutes / max) * 100)}%` }}
                    />
                    <span
                      className="plan-week-budget"
                      style={{ bottom: `${(plan.weeklyMinutes / max) * 100}%` }}
                      aria-hidden
                    />
                  </span>
                  <span className="plan-week-label">{day(w.weekStart)}</span>
                </li>
              );
            })}
          </ol>
          {accuracyTrend.length > 1 && (
            <div className="plan-trend">
              <span className="dash-label">Drill accuracy by week</span>
              <Sparkline
                values={accuracyTrend}
                label={`Accuracy by week: ${accuracyTrend.map((a) => pct(a)).join(', ')}`}
                width={220}
                height={44}
              />
            </div>
          )}
          <dl className="stat-row">
            <div>
              <dt>Days on it</dt>
              <dd className="tabular">{v.totals.days}</dd>
            </div>
            <div>
              <dt>Questions drilled</dt>
              <dd className="tabular">{v.totals.answers}</dd>
            </div>
            {v.totals.cleared > 0 && (
              <div>
                <dt>Misses cleared</dt>
                <dd className="tabular">{v.totals.cleared}</dd>
              </div>
            )}
          </dl>
          {v.milestones.length > 0 && (
            <ul className="plan-milestones" aria-label="Learned topics">
              {v.milestones.map((m) => (
                <li key={m.topicId}>
                  <Trophy size={14} aria-hidden /> {m.title}
                  <span className="muted text-sm">{fmtDate(m.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel as="section" className="plan-topics" aria-label="Topics">
        <div className="section-head">
          <h2 className="section-title">Topics</h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditTopic({ open: true, topic: null })}
          >
            <Plus size={14} aria-hidden /> Add a topic
          </Button>
        </div>
        <ol className="plan-topic-list">
          {v.topics.map((t, i) => {
            const node = nodeById.get(t.topic.id);
            return (
              <li key={t.topic.id} className={`plan-topic is-${t.state}`}>
                <span className="plan-topic-num tabular" aria-hidden>
                  {t.state === 'mastered' ? <Check size={14} /> : i + 1}
                </span>
                <div className="plan-topic-main">
                  <div className="plan-topic-line">
                    <span className="plan-topic-title">{t.topic.title}</span>
                    <span className={`plan-topic-state is-${t.state}`}>{STATE_LABEL[t.state]}</span>
                  </div>
                  <div className="plan-topic-meta muted text-sm">
                    {t.topic.resource && <Resource value={t.topic.resource} />}
                    <span className="tabular">
                      {fmtHours(t.loggedMinutes)} of {fmtHours(t.topic.plannedMinutes)}
                    </span>
                    {t.accuracy !== null && (
                      <span className="tabular">
                        {pct(t.accuracy)} lately · {t.rounds} round{t.rounds === 1 ? '' : 's'}
                      </span>
                    )}
                    {t.outstandingItems > 0 && (
                      <span className="tabular">
                        {t.outstandingItems} miss{t.outstandingItems === 1 ? '' : 'es'} to redo
                      </span>
                    )}
                  </div>
                  <ProgressBar
                    value={Math.min(1, t.hoursShare)}
                    label={`${t.topic.title}: hours logged against planned`}
                    className="plan-topic-bar"
                  />
                </div>
                <div className="plan-topic-actions">
                  {t.accuracyTrend.length > 1 && (
                    <Sparkline
                      values={t.accuracyTrend}
                      label={`Accuracy per round: ${t.accuracyTrend.map((a) => pct(a)).join(', ')}`}
                      width={72}
                      height={26}
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    aria-label={`Start a session on ${t.topic.title}`}
                    title="Start a session"
                    disabled={!node}
                    onClick={() => setStartFor(node ?? null)}
                  >
                    <Play size={14} aria-hidden />
                  </Button>
                  {t.topic.practice && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon
                      aria-label={`Log a drill on ${t.topic.title}`}
                      title="Log a drill"
                      onClick={() => setDrillFor(t)}
                    >
                      <Crosshair size={14} aria-hidden />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    aria-label={`Edit ${t.topic.title}`}
                    title="Edit"
                    onClick={() => setEditTopic({ open: true, topic: t })}
                  >
                    <Pencil size={14} aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
        {plan.method && (
          <p className="plan-method muted text-sm">
            <span className="plan-method-label">Method</span> {plan.method}
          </p>
        )}
      </Panel>

      <StartSessionDialog
        open={startFor !== null}
        onClose={() => setStartFor(null)}
        nodes={nodes.data?.nodes ?? []}
        node={startFor}
        lockSubject
        suggestedMinutes={60}
      />
      <DrillDialog
        open={drillFor !== null}
        onClose={() => setDrillFor(null)}
        topicTitle={drillFor?.topic.title ?? ''}
        busy={logDrill.isPending}
        onLog={async (input) => {
          if (!drillFor) return;
          try {
            const res = await logDrill.mutateAsync({ topicId: drillFor.topic.id, input });
            setDrillFor(null);
            const acc = roundAccuracy(input);
            if (res.mastered) celebrate(res);
            else if (acc !== null) toast(`Round logged: ${pct(acc)}.`, { tone: 'ok' });
          } catch (err) {
            fail(err, 'Could not log that round.');
          }
        }}
      />
      <TopicDialog
        open={editTopic.open}
        topic={editTopic.topic}
        onClose={() => setEditTopic({ open: false, topic: null })}
        busy={addTopic.isPending || updateTopic.isPending || deleteTopic.isPending}
        onSave={async (patch) => {
          try {
            if (editTopic.topic) {
              await updateTopic.mutateAsync({ id: editTopic.topic.topic.id, patch });
            } else {
              await addTopic.mutateAsync({ planId: plan.id, input: patch });
            }
            setEditTopic({ open: false, topic: null });
          } catch (err) {
            fail(err, 'Could not save that topic.');
          }
        }}
        onDelete={
          editTopic.topic
            ? async () => {
                try {
                  await deleteTopic.mutateAsync(editTopic.topic!.topic.id);
                  setEditTopic({ open: false, topic: null });
                } catch (err) {
                  fail(err, 'Could not delete that topic.');
                }
              }
            : undefined
        }
      />
      <PlanSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        view={v}
        busy={updatePlan.isPending || deletePlan.isPending}
        onSave={async (patch) => {
          try {
            await updatePlan.mutateAsync({ id: plan.id, patch });
            setSettingsOpen(false);
          } catch (err) {
            fail(err, 'Could not save that.');
          }
        }}
        onDelete={async () => {
          try {
            await deletePlan.mutateAsync(plan.id);
            navigate('/plans');
          } catch (err) {
            fail(err, 'Could not delete that plan.');
          }
        }}
      />
    </div>
  );
}

function PlanSettings({
  open,
  onClose,
  view,
  busy,
  onSave,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  view: PlanView;
  busy: boolean;
  onSave: (patch: {
    title: string;
    weeklyMinutes: number;
    targetDate: string | null;
    method: string | null;
    masteryTarget: number;
  }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [weekly, setWeekly] = useState('');
  const [target, setTarget] = useState('');
  const [method, setMethod] = useState('');
  const [mastery, setMastery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(view.plan.title);
    setWeekly(String(+(view.plan.weeklyMinutes / 60).toFixed(2)));
    setTarget(view.plan.targetDate ?? '');
    setMethod(view.plan.method ?? '');
    setMastery(String(Math.round(view.plan.masteryTarget * 100)));
    setConfirmDelete(false);
  }, [open, view]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit plan"
      actions={
        <>
          {confirmDelete ? (
            <Button variant="danger" loading={busy} onClick={onDelete}>
              Delete the plan and everything logged on it
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="plan-settings" variant="primary" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="plan-settings"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave({
            title: title.trim(),
            weeklyMinutes: Math.max(15, Math.round((Number(weekly) || 0) * 60)),
            targetDate: target || null,
            method: method.trim() || null,
            masteryTarget: Math.min(100, Math.max(50, Number(mastery) || 85)) / 100,
          });
        }}
      >
        <Input label="Name" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <div className="plan-dialog-pair">
          <Input
            label="Hours a week"
            type="number"
            min={0.25}
            step="0.25"
            value={weekly}
            onChange={(e) => setWeekly(e.target.value)}
          />
          <Input
            label="Target date"
            type="date"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </div>
        <Input
          label="Accuracy that counts as learned"
          hint="Over the last two drill rounds, with every named miss redone. Shaky counts half."
          type="number"
          min={50}
          max={100}
          value={mastery}
          onChange={(e) => setMastery(e.target.value)}
        />
        <Textarea
          label="How you work each topic"
          rows={3}
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        />
      </form>
    </Modal>
  );
}
