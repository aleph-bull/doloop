import { useState } from 'react';
import { Button, Spinner } from '@komogon/ui';
import type { EndSummary } from '../lib/api';
import { useActiveSession, useMe, useUpdateSettings } from '../lib/queries';
import { GetStarted } from './GetStarted';
import { NudgesCard } from './NudgesCard';
import { TimerCard } from './TimerCard';
import { RewardOverlay } from './RewardOverlay';

/**
 * The dashboard of an account with nothing in Tasks yet: ways to bring courses in, a running
 * session's timer, and the way to the full dashboard.
 */
export function FocusDashboard() {
  const me = useMe();
  const active = useActiveSession();
  const update = useUpdateSettings();
  const settings = me.data!.user.settings;
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<EndSummary | null>(null);

  const showMore = async () => {
    setError(null);
    try {
      await update.mutateAsync({ dashboard: { focusOnly: false } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not show the other features.');
    }
  };

  return (
    <div className="focus-dashboard">
      <div className="page-head">
        <div>
          <h1 className="page-title">Time to focus</h1>
          <p className="greeting-line">A little space for what you want to do.</p>
        </div>
      </div>
      <NudgesCard />
      {active.isPending ? (
        <Spinner />
      ) : active.isError ? (
        <div role="alert">
          <p>Could not check for a running session.</p>
          <Button onClick={() => void active.refetch()}>Try again</Button>
        </div>
      ) : active.data?.active ? (
        <TimerCard
          active={active.data.active}
          settings={settings}
          nodes={[]}
          onEnded={setSummary}
        />
      ) : null}
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      {/* Once anything is added, Today swaps this screen for the full dashboard. */}
      {!active.data?.active && (
        <GetStarted
          title="Got a lot due?"
          line="Bring it in all at once, and Komodon plans each day."
        />
      )}
      <Button variant="ghost" onClick={() => void showMore()} disabled={update.isPending}>
        Show full dashboard
      </Button>
      <RewardOverlay
        summary={summary}
        onClose={() => setSummary(null)}
        phrasesEnabled={settings.effects.phrases}
        badgeToasts={settings.effects.badgeToasts}
      />
    </div>
  );
}
