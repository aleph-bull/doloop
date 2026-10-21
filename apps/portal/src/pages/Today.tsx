import {
  standsInForChildren,
  type NodePace,
  type RoutineOccurrence,
  type Session,
  type StudyNode,
} from '@komogon/core';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Glass, Spinner, useToast } from '@komogon/ui';
import { CardRail } from '../components/CardRail';
import { DashboardStats } from '../components/DashboardStats';
import { ErrorPanel } from '../components/ErrorState';
import { FollowUpPrompt } from '../components/FollowUpPrompt';
import { FocusDashboard } from '../components/FocusDashboard';
import { Hint } from '../components/Hint';
import { NamePrompt } from '../components/NamePrompt';
import { NodeCard } from '../components/NodeCard';
import { TrackerBoard } from '../components/TrackerBoard';
import { UpcomingDue } from '../components/UpcomingDue';
import { PlanCard } from '../components/PlanCard';
import { QuoteCard } from '../components/QuoteCard';
import { RoutinesDueCard } from '../components/RoutinesDueCard';
import { RewardOverlay } from '../components/RewardOverlay';
import type { EndSummary } from '../lib/api';
import { StartSessionDialog } from '../components/StartSessionDialog';
import { TimerCard } from '../components/TimerCard';
import { TipCard } from '../components/TipCard';
import { NudgesCard } from '../components/NudgesCard';
import { useHints } from '../lib/hints';
import { useTip } from '../lib/use-tip';
import { openFocusTab } from '../lib/focus-tab';
import { fmtMinutes } from '../lib/format';
import { useGreeting } from '../lib/greeting';
import { useActiveSession, useMe, useNodes, usePace, useSessions } from '../lib/queries';

// Stable empty references, so the greeting is not recomputed on every render while the
// queries are still in flight.
const EMPTY_SESSIONS: Session[] = [];
const EMPTY_NODES: StudyNode[] = [];
const EMPTY_PACE: Record<string, NodePace> = {};

export function Today() {
  const me = useMe();
  return me.data?.user.settings.dashboard.focusOnly ? <FocusDashboard /> : <FullDashboard />;
}

function FullDashboard() {
  const me = useMe();
  const nodes = useNodes();
  const pace = usePace();
  const active = useActiveSession();
  const sessions = useSessions(undefined, 50);
  const [startFor, setStartFor] = useState<{
    node: StudyNode | null;
    routine?: RoutineOccurrence;
    minutes: number | null;
  } | null>(null);
  const [summary, setSummary] = useState<EndSummary | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  const openFocus = () => {
    if (openFocusTab() === 'blocked')
      toast('Allow pop-ups to open the focus screen in its own tab.');
  };

  /**
   * A pressing task named on the start panel takes you down to its card, lit for a
   * moment so the eye finds it. A task with no card here (nothing to show yet) goes to
   * the task tree instead.
   */
  const jumpTo = (nodeId: string) => {
    const el = document.getElementById(`task-${nodeId}`);
    if (!el) return void navigate('/tasks');
    const still =
      document.documentElement.dataset.motion === 'off' ||
      (document.documentElement.dataset.motion !== 'on' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    el.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center', inline: 'center' });
    el.classList.remove('is-spotlit');
    // Restart the animation even when the same card is picked twice in a row.
    void el.offsetWidth;
    el.classList.add('is-spotlit');
    el.addEventListener('animationend', () => el.classList.remove('is-spotlit'), { once: true });
  };

  const nodesById = useMemo(
    () => new Map((nodes.data?.nodes ?? []).map((n) => [n.id, n])),
    [nodes.data],
  );
  const settings = me.data?.user.settings;
  const sessionCount = sessions.data?.sessions.filter((s) => s.endedAt).length ?? 0;
  const { tip } = useTip();
  const { isDismissed } = useHints();
  const greeting = useGreeting({
    name: settings?.profile.name ?? null,
    streak: me.data?.user.streak.current ?? 0,
    sessions: sessions.data?.sessions ?? EMPTY_SESSIONS,
    nodes: nodes.data?.nodes ?? EMPTY_NODES,
    pace: pace.data?.pace ?? EMPTY_PACE,
  });

  const failed = [me, nodes, pace].find((q) => q.isError);
  if (failed && (!settings || !nodes.data || !pace.data)) {
    return (
      <ErrorPanel
        message={failed.error instanceof Error ? failed.error.message : 'Could not load today.'}
        onRetry={() => {
          void me.refetch();
          void nodes.refetch();
          void pace.refetch();
        }}
      />
    );
  }
  if (!settings || !nodes.data || !pace.data) {
    return (
      <div className="flex justify-center p-12">
        <Spinner />
      </div>
    );
  }

  const list = nodes.data.nodes;
  const roots = list.filter((n) => !n.parentId);
  const courseOf = (n: StudyNode) => {
    let cur = n;
    while (cur.parentId) {
      const p = nodesById.get(cur.parentId);
      if (!p) break;
      cur = p;
    }
    return cur.id === n.id ? undefined : cur.title;
  };
  const leaves = list.filter((n) => {
    if (n.kind === 'course' || n.completedAt) return false;
    const p = pace.data.pace[n.id];
    // Finished work stays off Today: marked done, or its estimate already used up.
    if (p?.status === 'done') return false;
    return !p || !standsInForChildren(p);
  });
  const totalToday = pace.data.plan.reduce((s, p) => s + p.suggestedMinutes, 0);
  const anyDue = list.some((n) => n.dueAt);

  return (
    <div className="dash">
      <div className="page-head">
        <div className="min-w-0">
          <h1 className="page-title">{greeting.salutation}</h1>
          <p className="greeting-line">{greeting.line}</p>
        </div>
      </div>

      <NamePrompt />

      {me.data?.streakMessage && (
        <Glass className="dash-note" role="status">
          {me.data.streakMessage}
        </Glass>
      )}

      {active.data?.active ? (
        <TimerCard
          active={active.data.active}
          settings={settings}
          nodes={list}
          onEnded={setSummary}
          footer={<QuoteCard inline />}
        />
      ) : (
        <PlanCard
          plan={pace.data.plan}
          nodesById={nodesById}
          onStart={() => setStartFor({ node: null, minutes: null })}
          onOpenFocus={openFocus}
          onPick={jumpTo}
          todayLine={
            totalToday > 0
              ? `About ${fmtMinutes(totalToday)} across ${pace.data.plan.length} item${pace.data.plan.length === 1 ? '' : 's'} today`
              : null
          }
          footer={<QuoteCard inline />}
        />
      )}

      <NudgesCard />
      <TipCard />

      {/* One-time hints sit with the start panel, where they are seen. Only one tip shows
          at a time: none while the tip card is up, otherwise the first that is due. */}
      {!tip &&
        [
          <Hint
            key="rest-days"
            id="rest-days"
            when={sessionCount >= 3}
            action={
              <Link to="/settings#rest-days" className="btn btn-secondary btn-sm">
                Set rest days
              </Link>
            }
          >
            Your daily plan works around rest days.
          </Hint>,
          <Hint
            key="xp"
            id="xp"
            when={sessionCount >= 1 && sessionCount < 3}
            action={
              <Link to="/achievements" className="btn btn-secondary btn-sm">
                Open Achievements
              </Link>
            }
          >
            Every session moves you toward the next level, and levels unlock new backgrounds.
          </Hint>,
          <Hint key="calendar" id="calendar" when={anyDue && sessionCount >= 2}>
            Plan study blocks and sync Google Calendar in Calendar.
          </Hint>,
        ].find((h) => h.props.when && !isDismissed(h.props.id))}

      {/* A first visit: the one thing to do comes before any numbers. */}
      {roots.length === 0 && (
        <Glass className="dash-first">
          <h2 className="section-title">Nothing to study yet</h2>
          <p className="muted">Add a course and what's due in it, and Today plans your day.</p>
          <Link to="/tasks" className="btn btn-primary btn-lg">
            Add your first course
          </Link>
        </Glass>
      )}

      <DashboardStats />

      <div className="dash-pair">
        <UpcomingDue nodes={list} pace={pace.data.pace} />
        <RoutinesDueCard
          onStart={(routine) => setStartFor({ node: null, routine, minutes: null })}
        />
      </div>

      {leaves.length > 0 && (
        <CardRail
          label="Your tasks"
          heading={<h2 className="section-title">Tasks</h2>}
          actions={
            <Link to="/tasks" className="section-link">
              Manage
            </Link>
          }
        >
          {leaves.map((n) => (
            <NodeCard
              key={n.id}
              node={n}
              pace={pace.data.pace[n.id]}
              plannedMinutes={pace.data.plannedMinutes?.[n.id] ?? 0}
              courseTitle={courseOf(n)}
              onStart={(node) => setStartFor({ node, minutes: null })}
            />
          ))}
        </CardRail>
      )}
      <FollowUpPrompt />

      <TrackerBoard />

      <RewardOverlay
        summary={summary}
        onClose={() => setSummary(null)}
        phrasesEnabled={settings.effects.phrases}
        badgeToasts={settings.effects.badgeToasts}
      />
      <StartSessionDialog
        open={startFor !== null}
        onClose={() => setStartFor(null)}
        nodes={list}
        node={startFor?.node}
        routine={startFor?.routine}
        suggestedMinutes={startFor?.minutes}
      />
    </div>
  );
}
