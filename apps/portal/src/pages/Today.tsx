import {
  standsInForChildren,
  type NodePace,
  type RoutineOccurrence,
  type Session,
  type StudyNode,
} from '@komodoit/core';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button, Glass, Spinner } from '@komodoit/ui';
import { CardRail } from '../components/CardRail';
import { ErrorPanel } from '../components/ErrorState';
import { FollowUpPrompt } from '../components/FollowUpPrompt';
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

  const nodesById = useMemo(
    () => new Map((nodes.data?.nodes ?? []).map((n) => [n.id, n])),
    [nodes.data],
  );
  const settings = me.data?.user.settings;
  const sessionCount = sessions.data?.sessions.filter((s) => s.endedAt).length ?? 0;
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
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-3xl">{greeting.salutation}</h1>
          <p className="greeting-line">{greeting.line}</p>
        </div>
        {!active.data?.active && (
          <Button variant="primary" onClick={() => setStartFor({ node: null, minutes: null })}>
            Start a session
          </Button>
        )}
      </div>

      <NamePrompt />

      {me.data?.streakMessage && (
        <Glass className="p-4 text-sm" role="status">
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
          onStart={(node, minutes) => setStartFor({ node, minutes })}
          todayLine={
            totalToday > 0
              ? `About ${fmtMinutes(totalToday)} across ${pace.data.plan.length} item${pace.data.plan.length === 1 ? '' : 's'} today`
              : null
          }
          footer={<QuoteCard inline />}
        />
      )}

      <UpcomingDue nodes={list} pace={pace.data.pace} />
      <RoutinesDueCard
        onStart={
          active.data?.active
            ? undefined
            : (routine) => setStartFor({ node: null, routine, minutes: null })
        }
      />
      <FollowUpPrompt />

      <Hint
        id="rest-days"
        when={sessionCount >= 3}
        action={
          <Link to="/settings#rest-days" className="btn btn-secondary btn-sm">
            Set rest days
          </Link>
        }
      >
        Rest days never break your streak. Set the days you don't study and pace will plan around
        them.
      </Hint>
      <Hint
        id="freezes"
        when={(me.data?.user.streak.current ?? 0) >= 3}
        action={
          <Link to="/achievements" className="btn btn-secondary btn-sm">
            Open the shop
          </Link>
        }
      >
        Your streak is growing. A streak freeze from the shop covers one missed day automatically.
      </Hint>
      <Hint id="xp" when={sessionCount >= 1 && sessionCount < 3}>
        Every session moves you toward the next level, and levels unlock accent colours and
        backgrounds. Achievements has the details.
      </Hint>
      <Hint id="calendar" when={anyDue && sessionCount >= 2}>
        Planned blocks and Google Calendar sync arrive in the Calendar tab, so you can see planned
        versus needed hours.
      </Hint>

      {leaves.length > 0 && (
        <CardRail
          label="Your tasks"
          heading={<h2 className="text-lg">Tasks</h2>}
          actions={
            <Link to="/tasks" className="text-sm">
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

      <TrackerBoard />

      {roots.length === 0 && (
        <Glass className="p-6 text-center">
          <p className="muted">No courses yet.</p>
          <Link to="/tasks" className="btn btn-primary mt-3">
            Add your first course
          </Link>
        </Glass>
      )}

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
