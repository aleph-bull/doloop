import { useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import type { HeatmapCell } from '@komogon/core';
import {
  ArrowLeft,
  Award,
  BadgeCheck,
  CalendarCheck,
  CalendarDays,
  ChevronRight,
  GraduationCap,
  Settings as SettingsIcon,
  Trophy,
  Users,
} from 'lucide-react';
import { Button, cn, Columns, Flame, Heatmap, Panel, ProgressBar, Spinner } from '@komogon/ui';
import { ErrorPanel } from '../components/ErrorState';
import { ProfileSettingsDialog } from '../components/ProfileSettingsDialog';
import { clockLabel, StudyClock } from '../components/recap/StudyClock';
import { SignOutButton } from '../components/SignOutButton';
import { Avatar } from '../components/social/Avatar';
import { FriendButton } from '../components/social/FriendButton';
import { LiveDot, LiveLine } from '../components/social/LiveNow';
import { PostCard } from '../components/social/PostCard';
import {
  ApiError,
  type LiveMember,
  type ProfileBadge,
  type ProfileStats,
  type PublicProfile,
} from '../lib/api';
import { fmtDate, fmtHours } from '../lib/format';
import { useProfile } from '../lib/queries';

export { Avatar };

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

function joined(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(
    new Date(iso),
  );
}

/**
 * Name, picture, university and a line about them, with the gear on your own. A running
 * daily streak sits on the picture's corner as a badge: the flame (it grows with the run)
 * and the day count, with the best in its tooltip.
 */
function Head({
  profile,
  live,
  streak,
  onSettings,
}: {
  profile: PublicProfile;
  live: LiveMember | null;
  /** Null when they keep their study time to themselves. */
  streak: ProfileStats['streak'] | null;
  onSettings: () => void;
}) {
  return (
    <Panel as="header" className="profile-head">
      {streak && streak.current > 0 ? (
        <span className="profile-avatar-wrap">
          <Avatar name={profile.name} url={profile.avatarUrl} />
          <span
            className="profile-avatar-streak"
            title={`Daily streak: ${streak.current} ${streak.current === 1 ? 'day' : 'days'}${
              streak.longest > streak.current ? `. Best ${streak.longest}.` : ''
            }`}
          >
            <Flame days={streak.current} size={32} />
            <span className="tabular" aria-hidden>
              {streak.current}
            </span>
            <span className="sr-only">
              Daily streak, {streak.current} {streak.current === 1 ? 'day' : 'days'}
            </span>
          </span>
        </span>
      ) : (
        <Avatar name={profile.name} url={profile.avatarUrl} />
      )}
      <div className="profile-id">
        <h1 className="page-title profile-name">
          {profile.name}
          {profile.gambler && (
            <span className="profile-gambler" role="img" aria-label="Gambler" title="Gambler">
              🎲
            </span>
          )}
        </h1>
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
        <div className="profile-actions is-own">
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

/** The weekly streak, a tile at the start of the totals row, with this week's days beside it. */
function WeeklyStreak({
  weeks,
  thisWeek,
}: {
  weeks: ProfileStats['streak']['weeks'];
  thisWeek: HeatmapCell[] | null;
}) {
  if (!weeks || (weeks.current <= 0 && weeks.longest <= 0)) return null;
  const lit = weeks.current > 0;
  const n = lit ? weeks.current : weeks.longest;
  return (
    <div className={cn('profile-streak is-weekly', lit && 'is-lit')}>
      <span className="profile-streak-icon" aria-hidden>
        <CalendarCheck size={24} />
      </span>
      <div className="profile-streak-text">
        <span className="profile-streak-label">{lit ? 'Weekly streak' : 'Best weekly streak'}</span>
        <span className="profile-streak-figure tabular">
          {n}
          <small>{n === 1 ? 'week' : 'weeks'}</small>
        </span>
        {lit && weeks.longest > weeks.current && (
          <span className="profile-streak-note">Best {weeks.longest}</span>
        )}
      </div>
      {thisWeek && thisWeek.length === 7 && (
        <ol className="profile-week" aria-label="This week">
          {thisWeek.map((d, i) => (
            <li
              key={d.date}
              className={cn('profile-week-day', d.minutes > 0 && 'is-on', d.future && 'is-future')}
              title={`${WEEKDAY_NAMES[i]}${d.minutes > 0 ? `: ${fmtHours(d.minutes)}` : ''}`}
            >
              <span className="profile-week-dot" aria-hidden />
              <span className="profile-week-letter" aria-hidden>
                {WEEKDAY_LETTERS[i]}
              </span>
              <span className="sr-only">
                {WEEKDAY_NAMES[i]}:{' '}
                {d.minutes > 0 ? 'studied' : d.future ? 'still to come' : 'no session'}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Their biggest badges, by what each paid; the XP itself stays on Achievements. */
function TopBadges({ badges, you }: { badges: ProfileBadge[]; you: boolean }) {
  return (
    <Panel as="section" className="rc-tile profile-badges" aria-labelledby="profile-badges-h">
      <div className="profile-side-head">
        <h2 id="profile-badges-h" className="rc-tile-title">
          Top badges
        </h2>
        {you && (
          <Link to="/achievements" className="side-link">
            All badges
            <ChevronRight size={14} aria-hidden />
          </Link>
        )}
      </div>
      <ul className="profile-badge-grid">
        {badges.map((b) => (
          <li key={b.key} className="profile-badge">
            <span className="badge-medal" aria-hidden>
              <Award size={18} />
            </span>
            <span className="profile-badge-name">{b.name}</span>
            <span className="profile-badge-desc">{b.description}</span>
            <span className="profile-badge-when">{fmtDate(b.unlockedAt)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/**
 * Someone's page on Komodon: who they are, the days they studied, their totals, and what
 * they have shared on Social with their top badges and hours of the day beside it. Your own
 * has a gear for the profile settings; someone else's has the friend button.
 */
export function Profile() {
  const { id } = useParams();
  const q = useProfile(id ?? 'me');
  // "#post-<id>" (or "#post-<id>-comments") from the notifications: that post, brought into view.
  const hash = useLocation().hash.match(/^#post-([0-9a-f-]{36})(-comments)?$/);
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
  const hidden = !stats || !heatmap || !weekday;
  const badges = q.data.badges ?? [];
  const clock = q.data.clock ?? null;

  // Only what is there to show: a quiet start is not a row of zeros. The streaks have places
  // of their own: the daily one on the picture, the weekly one at the start of this row.
  const totals: Array<{ label: string; value: number; unit: string }> = [];
  if (stats && studied) {
    totals.push({ label: 'Focus, all time', ...figure(stats.totalMinutes) });
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
  if (stats && stats.longestSessionMinutes > 0)
    totals.push({ label: 'Longest session', ...figure(stats.longestSessionMinutes) });
  if (stats && stats.last28Minutes > 0)
    totals.push({ label: 'Last 28 days', ...figure(stats.last28Minutes) });
  // Jack mode's dice, for anyone who has rolled them.
  if (stats?.jack && stats.jack.wonSeconds > 0)
    totals.push({ label: 'Break won', ...figure(stats.jack.wonSeconds / 60) });
  if (stats?.jack && stats.jack.lostSeconds > 0)
    totals.push({ label: 'Break lost', ...figure(stats.jack.lostSeconds / 60) });

  const weeks = stats?.streak.weeks;
  const weekly =
    weeks && (weeks.current > 0 || weeks.longest > 0) ? (
      <WeeklyStreak weeks={weeks} thisWeek={heatmap?.weeks.at(-1) ?? null} />
    ) : null;

  // Beside the posts: their top badges and when in the day they study.
  const side: ReactNode[] = [];
  if (hidden)
    side.push(
      <Panel key="hidden" as="section" className="rc-tile" aria-label="Study">
        <p className="muted text-sm">Keeps their study time to themselves.</p>
      </Panel>,
    );
  if (badges.length > 0) side.push(<TopBadges key="badges" badges={badges} you={you} />);
  if (clock && clock.totalMinutes > 0) {
    const title = 'Peak study hours';
    const note = clockLabel(clock, you);
    side.push(
      <Panel key="clock" as="section" className="rc-tile" aria-label={title}>
        <div className="rc-tile-head">
          <h2 className="rc-tile-title">{title}</h2>
          {note && <p className="rc-tile-note">{note}</p>}
        </div>
        <StudyClock clock={clock} />
      </Panel>,
    );
  }

  const postsList =
    posts.length > 0 || you ? (
      <section className="profile-posts-list" aria-label="Posts">
        <div className="profile-posts-head">
          <h2 className="rc-tile-title">Posts</h2>
          {you && (
            <Link to="/social" className="btn btn-ghost btn-sm">
              Share something
            </Link>
          )}
        </div>
        <div className="profile-posts-items">
          {posts.length === 0 ? (
            <p className="muted text-sm">Nothing shared yet.</p>
          ) : (
            posts.map((p) => (
              <PostCard
                key={p.id}
                post={p}
                people={people}
                focus={hash?.[1] === p.id ? (hash[2] ? 'comments' : 'post') : undefined}
              />
            ))
          )}
        </div>
      </section>
    ) : null;

  return (
    <div className="flex flex-col gap-6">
      <Head
        profile={profile}
        live={q.data.live ?? null}
        streak={stats?.streak ?? null}
        onSettings={() => setSettingsOpen(true)}
      />

      {/* Null when they keep their study time to themselves (Settings › Social). */}
      {!hidden && (
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
              {stats.level > 0 && <Level level={stats.level} ratio={stats.levelRatio} />}
            </div>
            {totals.length === 0 && !weekly ? (
              <p className="muted text-sm">
                {you ? 'Your first session will start the count.' : 'No sessions yet.'}
              </p>
            ) : (
              <div className="profile-totals-body">
                {weekly}
                {totals.length > 0 && (
                  <dl className="days-panel-stats profile-stats">
                    {totals.map((t) => (
                      <div key={t.label}>
                        <dt>{t.label}</dt>
                        <dd className="tabular">
                          {t.value}
                          <small>{t.unit}</small>
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            )}
          </Panel>
        </>
      )}

      {(side.length > 0 || postsList) && (
        <div className="profile-lower-wrap">
          <div
            className={cn(
              'profile-lower',
              !postsList && 'is-side-only',
              side.length === 0 && 'is-posts-only',
            )}
          >
            {side.length > 0 && <div className="profile-side">{side}</div>}
            {postsList}
          </div>
        </div>
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

/** The level with a slim bar of how far into it they are. No XP figures: those stay on Achievements. */
function Level({ level, ratio }: { level: number; ratio: number | undefined }) {
  const pct = ratio === undefined ? null : Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  return (
    <div
      className="rc-tile-note profile-level"
      title={pct === null ? undefined : `${pct}% of the way to level ${level + 1}`}
    >
      <Trophy size={13} aria-hidden />
      Level {level}
      {pct !== null && (
        <ProgressBar
          value={pct / 100}
          label={`Progress to level ${level + 1}`}
          className="profile-level-bar"
        />
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
