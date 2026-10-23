import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Flame } from 'lucide-react';
import { Panel, Sparkline } from '@komogon/ui';
import type { CompareRow, Person } from '../../lib/api';
import { fmtDate, fmtHours } from '../../lib/format';
import { useCompare } from '../../lib/queries';
import { Avatar } from './Avatar';

const unknown = (id: string): Person => ({
  id,
  name: 'Someone',
  username: null,
  avatarUrl: null,
  university: null,
});

/** "1st", "2nd", "3rd", "4th". */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Minutes as a big number with a small unit. */
function Figure({ minutes, unit }: { minutes: number; unit?: string }) {
  if (unit)
    return (
      <span className="cmp-figure tabular">
        {minutes}
        <small>{unit}</small>
      </span>
    );
  const [value, u] =
    minutes < 60
      ? [String(Math.round(minutes)), 'min']
      : [
          String(minutes / 60 >= 100 ? Math.round(minutes / 60) : Math.round(minutes / 6) / 10),
          'h',
        ];
  return (
    <span className="cmp-figure tabular">
      {value}
      <small>{u}</small>
    </span>
  );
}

function Tile({
  title,
  note,
  className,
  children,
}: {
  title: string;
  note?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Panel as="section" className={`rc-tile${className ? ` ${className}` : ''}`} aria-label={title}>
      <div className="rc-tile-head">
        <h2 className="rc-tile-title">{title}</h2>
        {note && <p className="rc-tile-note">{note}</p>}
      </div>
      {children}
    </Panel>
  );
}

/** Everyone on one scale: a thin bar each, yours in the full accent, sorted high to low. */
function BarList({
  rows,
  people,
  value,
  fmt,
  max,
  youId,
}: {
  rows: CompareRow[];
  people: Record<string, Person>;
  value: (r: CompareRow) => number;
  fmt: (v: number) => string;
  max?: number;
  youId: string;
}) {
  const sorted = [...rows].sort((a, b) => value(b) - value(a));
  const top = max ?? Math.max(1, ...rows.map(value));
  return (
    <ol className="cmp-bars">
      {sorted.map((r) => {
        const p = people[r.userId] ?? unknown(r.userId);
        const v = value(r);
        const you = r.userId === youId;
        return (
          <li key={r.userId} className={`cmp-bar-row${you ? ' is-you' : ''}`}>
            <Link to={you ? '/profile' : `/profile/${r.userId}`} className="cmp-bar-who">
              <Avatar name={p.name} url={p.avatarUrl} size="xs" />
              <span className="cmp-bar-name">{you ? 'You' : p.name}</span>
            </Link>
            <span className="cmp-bar-track" aria-hidden>
              <span className="cmp-bar-fill" style={{ width: `${(v / top) * 100}%` }} />
            </span>
            <span className="cmp-bar-value tabular">{fmt(v)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Your weeks beside your friends', under the friends board: this week, the last 28 days,
 * streaks, eight weeks of totals. Nothing until you have a friend.
 */
export function CompareBento() {
  const q = useCompare();
  if (!q.data || q.data.friends.length === 0) return null;
  const { you, friends, people, weekStarts } = q.data;

  const all = [you, ...friends];
  const n = all.length;
  const rank = (value: (r: CompareRow) => number) =>
    1 + friends.filter((f) => value(f) > value(you)).length;
  const avg = (value: (r: CompareRow) => number) =>
    friends.reduce((a, f) => a + value(f), 0) / friends.length;
  const weekRank = rank((r) => r.thisWeek);
  const monthRank = rank((r) => r.last28);
  const streakLeader = [...all].sort((a, b) => b.streak - a.streak)[0]!;
  const weekLabel = `${fmtDate(weekStarts[0])} to ${fmtDate(weekStarts[weekStarts.length - 1])}`;
  const name = (id: string) => (id === you.userId ? 'You' : (people[id] ?? unknown(id)).name);

  return (
    <div className="rc-bento cmp">
      <Tile title="This week" note={`${ordinal(weekRank)} of ${n}`}>
        <Figure minutes={you.thisWeek} />
        <p className="cmp-sub">Friends average {fmtHours(Math.round(avg((r) => r.thisWeek)))}</p>
      </Tile>
      <Tile title="Last 28 days" note={`${ordinal(monthRank)} of ${n}`}>
        <Figure minutes={you.last28} />
        <p className="cmp-sub">
          {you.activeDays28} of 28 days · friends average {Math.round(avg((r) => r.activeDays28))}
        </p>
      </Tile>
      <Tile
        title="Streak"
        note={
          streakLeader.streak > 0
            ? `${name(streakLeader.userId)} ${streakLeader.userId === you.userId ? 'lead' : 'leads'} at ${streakLeader.streak}`
            : 'No streaks running'
        }
      >
        <span className="cmp-figure tabular cmp-streak">
          <Flame size={22} aria-hidden />
          {you.streak}
          <small>{you.streak === 1 ? 'day' : 'days'}</small>
        </span>
        <p className="cmp-sub">{you.sessionsThisWeek} sessions this week</p>
      </Tile>

      <Tile title="This week, side by side" className="is-wide">
        <BarList
          rows={all}
          people={people}
          value={(r) => r.thisWeek}
          fmt={fmtHours}
          youId={you.userId}
        />
      </Tile>
      <Tile title="Streaks">
        <ol className="cmp-streaks">
          {[...all]
            .sort((a, b) => b.streak - a.streak)
            .map((r) => {
              const p = people[r.userId] ?? unknown(r.userId);
              const you_ = r.userId === you.userId;
              return (
                <li key={r.userId} className={`cmp-streak-row${you_ ? ' is-you' : ''}`}>
                  <Avatar name={p.name} url={p.avatarUrl} size="xs" />
                  <span className="cmp-bar-name">{you_ ? 'You' : p.name}</span>
                  <span className="cmp-streak-days tabular">
                    <Flame size={14} aria-hidden />
                    {r.streak}
                  </span>
                </li>
              );
            })}
        </ol>
      </Tile>

      <Tile title="Last eight weeks" note={weekLabel} className="is-full">
        <div className="cmp-multiples">
          {[...all]
            .sort((a, b) => b.last28 - a.last28)
            .map((r) => {
              const p = people[r.userId] ?? unknown(r.userId);
              const you_ = r.userId === you.userId;
              const total = r.weekly.reduce((a, b) => a + b, 0);
              return (
                <div key={r.userId} className={`cmp-multiple${you_ ? ' is-you' : ''}`}>
                  <div className="cmp-multiple-head">
                    <Avatar name={p.name} url={p.avatarUrl} size="xs" />
                    <span className="cmp-bar-name">{you_ ? 'You' : p.name}</span>
                    <span className="cmp-multiple-total tabular">{fmtHours(total)}</span>
                  </div>
                  <Sparkline
                    values={r.weekly}
                    label={`${you_ ? 'Your' : `${p.name}'s`} minutes per week over the last eight weeks`}
                    width={220}
                    height={44}
                  />
                </div>
              );
            })}
        </div>
      </Tile>

      <Tile title="Days studied, last 28" className="is-wide">
        <BarList
          rows={all}
          people={people}
          value={(r) => r.activeDays28}
          fmt={(v) => `${v} of 28`}
          max={28}
          youId={you.userId}
        />
      </Tile>
      <Tile title="Longest session, last 28 days">
        <BarList
          rows={all}
          people={people}
          value={(r) => r.longest28}
          fmt={fmtHours}
          youId={you.userId}
        />
      </Tile>
    </div>
  );
}
