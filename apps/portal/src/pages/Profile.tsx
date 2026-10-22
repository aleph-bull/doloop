import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  GraduationCap,
  Settings as SettingsIcon,
  Trophy,
  Users,
} from 'lucide-react';
import { Button, Columns, Heatmap, Panel, Spinner } from '@komogon/ui';
import { ErrorPanel } from '../components/ErrorState';
import { ProfileSettingsDialog } from '../components/ProfileSettingsDialog';
import { SignOutButton } from '../components/SignOutButton';
import { Avatar } from '../components/social/Avatar';
import { FriendButton } from '../components/social/FriendButton';
import { LiveDot, LiveLine } from '../components/social/LiveNow';
import { PostCard } from '../components/social/PostCard';
import { ApiError, type LiveMember, type PublicProfile } from '../lib/api';
import { fmtDate, fmtHours } from '../lib/format';
import { useProfile } from '../lib/queries';

export { Avatar };

function joined(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(
    new Date(iso),
  );
}

/** Name, picture, university and a line about them, with the gear on your own. */
function Head({
  profile,
  live,
  onSettings,
}: {
  profile: PublicProfile;
  live: LiveMember | null;
  onSettings: () => void;
}) {
  return (
    <Panel as="header" className="profile-head">
      <Avatar name={profile.name} url={profile.avatarUrl} />
      <div className="profile-id">
        <h1 className="page-title profile-name">{profile.name}</h1>
        <div className="pill-row">
          {live && (
            <span className="chip chip-neutral profile-chip profile-live">
              <LiveDot live={live} small />
              Studying now · <LiveLine live={live} />
            </span>
          )}
          {profile.university && (
            <span
              className="chip chip-neutral profile-chip"
              title="Verified with a university email address"
            >
              <GraduationCap size={13} aria-hidden />
              {profile.university.name}
              <BadgeCheck size={13} aria-hidden className="profile-verified" />
              <span className="sr-only">, verified</span>
            </span>
          )}
          <span className="chip chip-neutral profile-chip">
            <CalendarDays size={13} aria-hidden />
            Joined {joined(profile.joinedAt)}
          </span>
          {profile.friendCount > 0 && (
            <Link to="/social?tab=friends" className="chip chip-neutral profile-chip">
              <Users size={13} aria-hidden />
              {profile.friendCount} {profile.friendCount === 1 ? 'friend' : 'friends'}
            </Link>
          )}
        </div>
      </div>
      {profile.you ? (
        <div className="profile-actions">
          <Button
            icon
            variant="ghost"
            aria-label="Profile settings"
            title="Profile settings"
            onClick={onSettings}
          >
            <SettingsIcon size={18} aria-hidden />
          </Button>
          <SignOutButton labelled />
        </div>
      ) : (
        <div className="profile-actions">
          <FriendButton
            userId={profile.id}
            friendship={profile.friendship}
            acceptsRequests={profile.acceptsRequests}
            remove
          />
          <Link to="/social" className="btn btn-ghost btn-sm profile-gear">
            <ArrowLeft size={15} aria-hidden />
            Social
          </Link>
        </div>
      )}
      {/* Its own row under the name, so it reads at full width on a phone too. */}
      {profile.bio && (
        <p className="profile-bio">
          <span>{profile.bio}</span>
        </p>
      )}
    </Panel>
  );
}

/**
 * Someone's page on Komodon: who they are, the days they studied, their totals and what they
 * have shared on Social. Your own has a gear for the profile settings; someone else's has
 * the friend button.
 */
export function Profile() {
  const { id } = useParams();
  const q = useProfile(id ?? 'me');
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (q.isError)
    return <ErrorPanel message={describe(q.error, id ?? 'me')} onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <div className="flex justify-center p-12">
        <Spinner />
      </div>
    );

  const { profile, stats, heatmap, weekday, posts, people } = q.data;
  const you = profile.you;
  const days = heatmap?.activeDays ?? 0;
  const studied = (stats?.totalMinutes ?? 0) > 0;

  // Only what is there to show: a quiet start is not a row of zeros.
  const totals: Array<{ label: string; value: number; unit: string; note?: string }> = [];
  if (stats && studied) {
    totals.push({ label: 'Studied, all time', ...figure(stats.totalMinutes) });
    totals.push({
      label: 'Sessions',
      value: stats.totalSessions,
      unit: stats.totalSessions === 1 ? 'session' : 'sessions',
    });
    totals.push({
      label: 'Days studied',
      value: stats.activeDays,
      unit: stats.activeDays === 1 ? 'day' : 'days',
    });
  }
  if (stats && stats.streak.current > 0)
    totals.push({
      label: 'Daily streak',
      value: stats.streak.current,
      unit: stats.streak.current === 1 ? 'day' : 'days',
      note:
        stats.streak.longest > stats.streak.current ? `Best ${stats.streak.longest}` : undefined,
    });
  else if (stats && stats.streak.longest > 0)
    totals.push({
      label: 'Best daily streak',
      value: stats.streak.longest,
      unit: stats.streak.longest === 1 ? 'day' : 'days',
    });
  const weeks = stats?.streak.weeks;
  if (weeks && weeks.current > 0)
    totals.push({
      label: 'Weekly streak',
      value: weeks.current,
      unit: weeks.current === 1 ? 'week' : 'weeks',
      note: weeks.longest > weeks.current ? `Best ${weeks.longest}` : undefined,
    });
  else if (weeks && weeks.longest > 0)
    totals.push({
      label: 'Best weekly streak',
      value: weeks.longest,
      unit: weeks.longest === 1 ? 'week' : 'weeks',
    });
  if (stats && stats.longestSessionMinutes > 0)
    totals.push({ label: 'Longest session', ...figure(stats.longestSessionMinutes) });
  if (stats && stats.last28Minutes > 0)
    totals.push({ label: 'Last 28 days', ...figure(stats.last28Minutes) });

  return (
    <div className="flex flex-col gap-6">
      <Head profile={profile} live={q.data.live ?? null} onSettings={() => setSettingsOpen(true)} />

      {/* Null when they keep their study time to themselves (Settings › Social). */}
      {!stats || !heatmap || !weekday ? (
        <Panel as="section" className="rc-tile" aria-label="Study">
          <p className="muted text-sm">Keeps their study time to themselves.</p>
        </Panel>
      ) : (
        <>
          <div className="profile-study">
            <Panel as="section" className="rc-tile profile-study-col" aria-label="Days studied">
              <div className="rc-tile-head">
                <h2 className="rc-tile-title">Days studied</h2>
                <p className="rc-tile-note">
                  {days === 0
                    ? 'The last six months. Each day with a session lights up a square.'
                    : `${days} active ${days === 1 ? 'day' : 'days'} in the last six months${
                        heatmap.longestRun >= 2
                          ? `, with a longest streak of ${heatmap.longestRun}`
                          : ''
                      }.`}
                </p>
              </div>
              <div className="profile-grid">
                <Heatmap
                  weeks={heatmap.weeks}
                  monthLabels={spacedLabels(heatmap.monthLabels)}
                  thresholds={heatmap.thresholds}
                  ariaLabel={`Study minutes per day from ${heatmap.from} to ${heatmap.to}`}
                />
              </div>
            </Panel>
            {weekday.totalMinutes > 0 && (
              <Panel as="section" className="rc-tile profile-study-col" aria-label="Strongest days">
                <div className="rc-tile-head">
                  <h2 className="rc-tile-title">Strongest days</h2>
                  {weekday.peak && (
                    <p className="rc-tile-note">{weekday.peak.label} carries the most.</p>
                  )}
                </div>
                <Columns
                  bars={weekday.buckets.map((b) => ({
                    label: b.label.slice(0, 3),
                    value: b.minutes,
                    highlight: b.label === weekday.peak?.label,
                  }))}
                  fmt={fmtHours}
                  columnName="Day"
                  ariaLabel="Study time by day of the week"
                />
              </Panel>
            )}
          </div>

          <Panel as="section" className="rc-tile profile-totals" aria-label="Totals">
            <div className="rc-tile-head">
              <h2 className="rc-tile-title">Totals</h2>
              {stats.level > 0 && (
                <p className="rc-tile-note profile-level">
                  <Trophy size={13} aria-hidden />
                  Level {stats.level}
                </p>
              )}
            </div>
            {totals.length === 0 ? (
              <p className="muted text-sm">
                {you ? 'Your first session will start the count.' : 'No sessions yet.'}
              </p>
            ) : (
              <dl className="days-panel-stats">
                {totals.map((t) => (
                  <div key={t.label}>
                    <dt>{t.label}</dt>
                    <dd className="tabular">
                      {t.value}
                      <small>{t.unit}</small>
                    </dd>
                    {t.note && <dd className="profile-stat-note">{t.note}</dd>}
                  </div>
                ))}
              </dl>
            )}
          </Panel>
        </>
      )}

      {(posts.length > 0 || you) && (
        <section className="profile-posts-list" aria-label="Posts">
          <div className="profile-posts-head">
            <h2 className="rc-tile-title">Posts</h2>
            {you && (
              <Link to="/social" className="btn btn-ghost btn-sm">
                Share something
              </Link>
            )}
          </div>
          {posts.length === 0 ? (
            <p className="muted text-sm">Nothing shared yet.</p>
          ) : (
            posts.map((p) => <PostCard key={p.id} post={p} people={people} />)
          )}
        </section>
      )}

      {you && (
        <ProfileSettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          profile={profile}
        />
      )}
      {stats?.bestDay && studied && (
        <p className="sr-only">Best day {fmtDate(stats.bestDay.date)}.</p>
      )}
    </div>
  );
}

/** Why a profile didn't load, in words that say what to do. */
function describe(err: unknown, id: string): string {
  if (err instanceof ApiError && err.status === 404) {
    // The API itself has no profile route: a copy started before the Social page existed.
    if (/route/i.test(err.message) || /not found/i.test(err.message))
      return 'The API this app is talking to is older than the app and has no profiles yet. Restart it, then try again.';
    return id === 'me' ? 'Your profile is not ready yet.' : 'There is no profile at this address.';
  }
  const detail = err instanceof Error && err.message ? ` (${err.message})` : '';
  return `Could not load this profile${detail}.`;
}

/** Month labels at least three columns apart, so a month that starts in the first column does not overlap the next. */
function spacedLabels(labels: Array<{ column: number; label: string }>) {
  const out: Array<{ column: number; label: string }> = [];
  for (const l of labels) {
    const prev = out[out.length - 1];
    if (prev && l.column - prev.column < 3) out.pop();
    out.push(l);
  }
  return out;
}

/** Minutes as a big number with a small unit: "1.5 h", "45 min". */
function figure(minutes: number): { value: number; unit: string } {
  if (minutes < 60) return { value: Math.max(1, Math.round(minutes)), unit: 'min' };
  const h = minutes / 60;
  return { value: h >= 100 ? Math.round(h) : Math.round(h * 10) / 10, unit: 'h' };
}
