import type { StudyNode } from '@doloop/core';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button, Glass, Spinner } from '@doloop/ui';
import { FollowUpPrompt } from '../components/FollowUpPrompt';
import { Hint } from '../components/Hint';
import { NodeCard } from '../components/NodeCard';
import { PlanCard } from '../components/PlanCard';
import { QuoteCard } from '../components/QuoteCard';
import { RewardOverlay } from '../components/RewardOverlay';
import type { EndSummary } from '../lib/api';
import { StartSessionDialog } from '../components/StartSessionDialog';
import { TimerCard } from '../components/TimerCard';
import { fmtMinutes } from '../lib/format';
import { useActiveSession, useMe, useNodes, usePace, useSessions } from '../lib/queries';

export function Today() {
  const me = useMe();
  const nodes = useNodes();
  const pace = usePace();
  const active = useActiveSession();
  const sessions = useSessions(undefined, 50);
  const [startFor, setStartFor] = useState<{
    node: StudyNode | null;
    minutes: number | null;
  } | null>(null);
  const [summary, setSummary] = useState<EndSummary | null>(null);

  const nodesById = useMemo(
    () => new Map((nodes.data?.nodes ?? []).map((n) => [n.id, n])),
    [nodes.data],
  );
  const settings = me.data?.user.settings;
  const sessionCount = sessions.data?.sessions.filter((s) => s.endedAt).length ?? 0;

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
  const leaves = list.filter(
    (n) => n.kind !== 'course' && !n.completedAt && !pace.data.pace[n.id]?.aggregated,
  );
  const totalToday = pace.data.plan.reduce((s, p) => s + p.suggestedMinutes, 0);
  const anyDue = list.some((n) => n.dueAt);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl">Today</h1>
          {totalToday > 0 && (
            <p className="muted text-sm mt-1">
              About {fmtMinutes(totalToday)} across {pace.data.plan.length} item
              {pace.data.plan.length === 1 ? '' : 's'}.
            </p>
          )}
        </div>
        {!active.data?.active && (
          <Button variant="primary" onClick={() => setStartFor({ node: null, minutes: null })}>
            Start a session
          </Button>
        )}
      </div>

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
        />
      ) : (
        <PlanCard
          plan={pace.data.plan}
          nodesById={nodesById}
          onStart={(node, minutes) => setStartFor({ node, minutes })}
        />
      )}

      <FollowUpPrompt />
      <QuoteCard />

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
      <Hint id="xp" when={sessionCount >= 1 && sessionCount < 3}>
        Every session earns XP. Honest reviews and focused blocks earn a little more. Levels unlock
        accent colours.
      </Hint>
      <Hint id="calendar" when={anyDue && sessionCount >= 2}>
        Planned blocks and Google Calendar sync arrive in the Calendar tab, so you can see planned
        versus needed hours.
      </Hint>

      {leaves.length > 0 && (
        <section aria-label="Your tasks" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg">Tasks</h2>
            <Link to="/tasks" className="text-sm">
              Manage
            </Link>
          </div>
          <div className="card-grid">
            {leaves.slice(0, 6).map((n) => (
              <NodeCard
                key={n.id}
                node={n}
                pace={pace.data.pace[n.id]}
                plannedMinutes={pace.data.plannedMinutes?.[n.id] ?? 0}
                courseTitle={courseOf(n)}
                onStart={(node) => setStartFor({ node, minutes: null })}
              />
            ))}
          </div>
        </section>
      )}

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
      />
      <StartSessionDialog
        open={startFor !== null}
        onClose={() => setStartFor(null)}
        nodes={list}
        node={startFor?.node}
        suggestedMinutes={startFor?.minutes}
      />
    </div>
  );
}
