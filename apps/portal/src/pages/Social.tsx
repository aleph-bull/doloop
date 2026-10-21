import { Navigate, useSearchParams } from 'react-router';
import { Segmented } from '@komogon/ui';
import { Feed } from '../components/social/Feed';
import { JamsTab } from '../components/social/JamsTab';
import { LeaderboardTab } from '../components/social/LeaderboardTab';
import { useFriends, useJams } from '../lib/queries';

const TABS = ['feed', 'jams', 'leaderboard'] as const;
type Tab = (typeof TABS)[number];

/**
 * Social: what people share (sessions, timelapses, a line about how it went) with friends
 * kept beside the feed, the jams people enter, and the leaderboard.
 */
export function Social() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'feed';
  const waiting = useFriends().data?.incoming.length ?? 0;
  const running = useJams().data?.active.length ?? 0;
  // The friends and compare tabs are gone (2026-10-21): friends sit beside the feed, compare became jams.
  if (raw === 'friends') return <Navigate to="/social" replace />;
  if (raw === 'compare') return <Navigate to="/social?tab=jams" replace />;

  const badge = (n: number, what: string) =>
    n > 0 && (
      <span className="seg-badge tabular" aria-label={`${n} ${what}`}>
        {n}
      </span>
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <h1 className="page-title">Social</h1>
        <Segmented
          ariaLabel="Social view"
          value={tab}
          onChange={(v) => setParams(v === 'feed' ? {} : { tab: v })}
          options={[
            {
              value: 'feed',
              label: (
                <>
                  Feed
                  {badge(waiting, 'friend requests waiting')}
                </>
              ),
            },
            {
              value: 'jams',
              label: (
                <>
                  Jams
                  {badge(running, 'running')}
                </>
              ),
            },
            { value: 'leaderboard', label: 'Leaderboard' },
          ]}
        />
      </div>
      {tab === 'jams' ? <JamsTab /> : tab === 'leaderboard' ? <LeaderboardTab /> : <Feed />}
    </div>
  );
}
