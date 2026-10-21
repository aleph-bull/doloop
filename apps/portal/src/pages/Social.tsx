import { useSearchParams } from 'react-router';
import { Segmented } from '@komogon/ui';
import { CompareTab } from '../components/social/CompareTab';
import { Feed } from '../components/social/Feed';
import { FriendsTab } from '../components/social/FriendsTab';
import { LeaderboardTab } from '../components/social/LeaderboardTab';
import { useFriends } from '../lib/queries';

const TABS = ['feed', 'friends', 'compare', 'leaderboard'] as const;
type Tab = (typeof TABS)[number];

/**
 * Social: what people share (sessions, timelapses, a line about how it went), the friends
 * who see it, how your weeks compare with theirs, and the leaderboard.
 */
export function Social() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'feed';
  const waiting = useFriends().data?.incoming.length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <h1 className="page-title">Social</h1>
        <Segmented
          ariaLabel="Social view"
          value={tab}
          onChange={(v) => setParams(v === 'feed' ? {} : { tab: v })}
          options={[
            { value: 'feed', label: 'Feed' },
            {
              value: 'friends',
              label: (
                <>
                  Friends
                  {waiting > 0 && (
                    <span className="seg-badge tabular" aria-label={`${waiting} waiting`}>
                      {waiting}
                    </span>
                  )}
                </>
              ),
            },
            { value: 'compare', label: 'Compare' },
            { value: 'leaderboard', label: 'Leaderboard' },
          ]}
        />
      </div>
      {tab === 'friends' ? (
        <FriendsTab />
      ) : tab === 'compare' ? (
        <CompareTab />
      ) : tab === 'leaderboard' ? (
        <LeaderboardTab />
      ) : (
        <Feed />
      )}
    </div>
  );
}
