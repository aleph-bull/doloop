import { pickEquivalents } from '@komogon/core';
import { ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { CountUp, Flame, Glass, Ring, SkeletonBlock, Sparkline } from '@komogon/ui';
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

/**
 * The dashboard's numbers at a glance: everything studied, this week against the goal,
 * the streak beside the best one, the last seven days as a line, and one playful
 * comparison that leads to the full recap.
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
      <SkeletonBlock className="dash-stats-skeleton" style={{ height: 132 }} />
    );
  const d = q.data;
  const hours = d.totalMinutes / 60;

  // Before the first session there is nothing to count, and a row of zeros says so in
  // the least welcoming way. One line instead, until there is something to show.
  if (d.totalMinutes <= 0)
    return (
      <Glass as="section" className="dash-stats dash-stats-empty rc-rise" aria-label="Your numbers">
        <Flame days={0} size={40} />
        <div>
          <span className="dash-value">Your numbers live here.</span>
          <span className="muted text-sm">
            Time studied, the week against your {fmtHours(d.goalMinutes)} goal, and your streak
            all start counting with your first session.
          </span>
        </div>
      </Glass>
    );

  return (
    <Glass as="section" className="dash-stats rc-rise" aria-label="Your numbers">
      <div className="dash-stat is-total">
        <span className="dash-label">Studied, all time</span>
        <span className="dash-figure">
          {d.totalMinutes < 60 ? (
            <>
              <CountUp value={Math.round(d.totalMinutes)} format={(v) => String(Math.round(v))} />
              <small> min</small>
            </>
          ) : (
            <>
              <CountUp
                value={hours}
                format={(v) => (hours >= 100 ? String(Math.round(v)) : v.toFixed(1))}
              />
              <small> h</small>
            </>
          )}
        </span>
      </div>

      <div className="dash-stat is-week">
        <Ring
          value={d.goalRatio}
          size={72}
          stroke={8}
          label={`${fmtHours(d.weekMinutes)} this week of a ${fmtHours(d.goalMinutes)} goal`}
        >
          <span className="dash-ring-text">{Math.round(d.goalRatio * 100)}%</span>
        </Ring>
        <div>
          <span className="dash-label">This week</span>
          <span className="dash-value">
            {fmtHours(d.weekMinutes)} <small className="muted">of {fmtHours(d.goalMinutes)}</small>
          </span>
          <Link to="/settings#pace" className="dash-link">
            Change goal
          </Link>
        </div>
      </div>

      <div className="dash-stat is-streak">
        <Flame days={d.streak.current} size={40} />
        <div>
          <span className="dash-label">Streak</span>
          <span className="dash-value">
            {d.streak.current} {d.streak.current === 1 ? 'day' : 'days'}
            <small className="muted"> · Best: {d.streak.longest}</small>
          </span>
        </div>
      </div>

      <div className="dash-stat is-spark">
        <span className="dash-label">Last 7 days</span>
        <Sparkline
          values={d.sparkline.map((x) => x.minutes)}
          label={`Study time over the last seven days: ${d.sparkline.map((x) => fmtHours(x.minutes)).join(', ')}`}
        />
      </div>

      {fun && (
        <Link to="/analytics" className="dash-fun">
          <span aria-hidden>{fun.icon}</span>
          <span>You&rsquo;ve studied enough to {fun.text}</span>
          <ChevronRight size={16} aria-hidden />
        </Link>
      )}
    </Glass>
  );
}
