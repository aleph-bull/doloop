import { pickEquivalents } from '@komogon/core';
import { ChevronRight, Flame as FlameIcon } from 'lucide-react';
import { useMemo, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { CountUp, Glass, SkeletonBlock } from '@komogon/ui';
import { fmtHours } from '../lib/format';
import { useDashboardStats, useScreens } from '../lib/queries';

/** The day of the year, so the fun line changes once a day rather than on every render. */
function daySeed(now: string): number {
  const d = new Date(now);
  return (
    d.getFullYear() * 400 +
    Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86_400_000)
  );
}

const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A count of hours as the hero shows it: one decimal under 100, whole above. */
function Hours({ minutes }: { minutes: number }) {
  if (minutes < 60)
    return (
      <>
        <CountUp value={Math.round(minutes)} format={(v) => String(Math.round(v))} />
        <small>min</small>
      </>
    );
  const hours = minutes / 60;
  return (
    <>
      <CountUp
        value={hours}
        format={(v) => (hours >= 100 ? String(Math.round(v)) : v.toFixed(1))}
      />
      <small>h</small>
    </>
  );
}

/**
 * The dashboard's numbers, run-tracker style: this week is the hero (the number you can
 * still move), with the goal as a bar, the last seven days as columns, and everything
 * studied and the daily and weekly streaks beside their bests underneath. One playful comparison leads on to
 * the full recap.
 */
export function DashboardStats() {
  const q = useDashboardStats();
  const screens = useScreens();
  const fun = useMemo(() => {
    if (!q.data || q.data.totalMinutes <= 0) return null;
    return (
      pickEquivalents({
        minutes: q.data.totalMinutes,
        seed: daySeed(q.data.now),
        count: 1,
        screens: screens.data?.facts,
      })[0] ?? null
    );
  }, [q.data, screens.data]);

  if (!q.data)
    return q.isError ? null : (
      <SkeletonBlock className="dash-stats-skeleton" style={{ height: 248 }} />
    );
  const d = q.data;

  // Before the first session there is nothing to count, and a row of zeros says so in
  // the least welcoming way. One line instead, until there is something to show.
  if (d.totalMinutes <= 0)
    return (
      <Glass as="section" className="dash-empty rc-rise" aria-label="Your numbers">
        <span className="streak-badge" aria-hidden>
          <FlameIcon size={24} />
        </span>
        <div>
          <span className="dash-empty-title">
            Your numbers are here after your first session. Run your first session!
          </span>
          <span className="dash-empty-body">Time studied this week vs. your goal.</span>
        </div>
      </Glass>
    );

  const peak = Math.max(60, ...d.sparkline.map((x) => x.minutes));
  // A response from the offline cache may predate weekly streaks.
  const weeks = (d.streak as Partial<typeof d.streak>).weeks ?? { current: 0, longest: 0 };
  const pct = Math.round(d.goalRatio * 100);

  return (
    <Glass as="section" className="dash-hero rc-rise" aria-label="Your numbers">
      <div className="dash-week">
        <span className="dash-label">This week</span>
        <span className="dash-hero-figure">
          <Hours minutes={d.weekMinutes} />
        </span>
        <div className="dash-goal">
          <div
            className="dash-goal-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, pct)}
            aria-label={`${fmtHours(d.weekMinutes)} this week of a ${fmtHours(d.goalMinutes)} goal`}
          >
            <span style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <div className="dash-goal-row">
            <span>
              <strong className="tabular">{pct}%</strong> of {fmtHours(d.goalMinutes)}
            </span>
            <Link to="/settings#pace" className="dash-link">
              Change goal
            </Link>
          </div>
        </div>
      </div>

      <div
        className="dash-days"
        role="img"
        aria-label={`Study time over the last seven days: ${d.sparkline.map((x) => fmtHours(x.minutes)).join(', ')}`}
      >
        <span className="dash-label">Last 7 days</span>
        <ol className="dash-days-cols" aria-hidden>
          {d.sparkline.map((x, i) => {
            const day = new Date(`${x.date}T12:00:00`).getDay();
            const today = i === d.sparkline.length - 1;
            return (
              <li
                key={x.date}
                className={`dash-day${today ? ' is-today' : ''}${x.minutes > 0 ? '' : ' is-empty'}`}
                title={`${WEEKDAY_LONG[day]}: ${x.minutes > 0 ? fmtHours(x.minutes) : 'nothing'}`}
              >
                <span className="dash-day-track">
                  <span
                    className="dash-day-bar"
                    style={
                      {
                        '--h': `${Math.max(6, (x.minutes / peak) * 100)}%`,
                        '--i': i,
                      } as CSSProperties
                    }
                  />
                </span>
                <span className="dash-day-label">{WEEKDAY[day]}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <dl className="dash-foot">
        <div className="dash-foot-stat">
          <dt className="dash-label">Focus, all time</dt>
          <dd className="dash-foot-figure">
            <Hours minutes={d.totalMinutes} />
          </dd>
        </div>
        <div className="dash-foot-stat is-streak">
          <dt className="dash-label">Daily streak</dt>
          <dd className="dash-foot-figure">
            <span>
              {d.streak.current}
              <small>{d.streak.current === 1 ? 'day' : 'days'}</small>
            </span>
          </dd>
          <dd className="dash-foot-note">Best {d.streak.longest}</dd>
        </div>
        <div className="dash-foot-stat is-streak">
          <dt className="dash-label">Weekly streak</dt>
          <dd className="dash-foot-figure">
            <span>
              {weeks.current}
              <small>{weeks.current === 1 ? 'week' : 'weeks'}</small>
            </span>
          </dd>
          <dd className="dash-foot-note">Best {weeks.longest}</dd>
        </div>
        {fun && (
          <div className="dash-foot-stat is-fun">
            <Link to="/analytics" className="dash-fun">
              <span className="dash-fun-icon" aria-hidden>
                {fun.icon}
              </span>
              <span className="dash-fun-text">You&rsquo;ve studied enough to {fun.text}</span>
              <ChevronRight size={16} aria-hidden className="dash-fun-chevron" />
            </Link>
          </div>
        )}
      </dl>
    </Glass>
  );
}
