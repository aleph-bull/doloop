import { Navigate, useSearchParams } from 'react-router';
import { Segmented } from '@komogon/ui';
import { Feed } from '../components/social/Feed';
import { FriendsButton } from '../components/social/FeedSide';
import { GroupsTab } from '../components/social/GroupsTab';
import { JamsTab } from '../components/social/JamsTab';
import { LeaderboardTab } from '../components/social/LeaderboardTab';
import { NotificationsBell } from '../components/social/Notifications';
import { NotificationsAsk } from '../components/social/NotificationsAsk';
import { SchoolTab } from '../components/social/SchoolTab';
import { NARROW_QUERY, useMediaQuery } from '../lib/media';
import { useFriends, useJams } from '../lib/queries';

const TABS = ['feed', 'school', 'groups', 'jams', 'leaderboard'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  feed: 'Feed',
  school: 'School',
  groups: 'Groups',
  jams: 'Jams',
  leaderboard: 'Leaderboard',
};

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
  const phone = useMediaQuery(NARROW_QUERY);
  // The friends and compare tabs are gone (2026-10-21): friends sit beside the feed, compare became jams.
  if (raw === 'friends') return <Navigate to="/social" replace />;
  if (raw === 'compare') return <Navigate to="/social?tab=jams" replace />;

  const badge = (n: number, what: string) =>
    n > 0 && (
      <span className="seg-badge tabular" aria-label={`${n} ${what}`}>
        {n}
      </span>
    );
  const content =
    tab === 'school' ? (
      <SchoolTab />
    ) : tab === 'groups' ? (
      <GroupsTab />
    ) : tab === 'jams' ? (
      <JamsTab />
    ) : tab === 'leaderboard' ? (
      <LeaderboardTab />
    ) : (
      <Feed />
    );

  // A phone: friends and the bell at the top beside the title, the views as plain words, all
  // on one big card that covers the window (the Backdrop's sheet, turned on by AppShell).
  if (phone)
    return (
      <div className="social-page flex flex-col gap-4">
        <div className="social-top">
          <FriendsButton />
          <h1 className="page-title social-top-title">Social</h1>
          <NotificationsBell round />
        </div>
        <div className="social-tabs" role="group" aria-label="Social view">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              className="social-tab"
              aria-pressed={tab === t}
              onClick={() => setParams(t === 'feed' ? {} : { tab: t })}
            >
              {TAB_LABELS[t]}
              {t === 'jams' && badge(running, 'running')}
            </button>
          ))}
        </div>
        {content}
        <NotificationsAsk />
      </div>
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
            { value: 'school', label: 'School' },
            { value: 'groups', label: 'Groups' },
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
      {content}
      <NotificationsAsk />
    </div>
  );
}
