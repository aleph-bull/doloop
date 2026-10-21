import { Link, useSearchParams } from 'react-router';
import { Crown } from 'lucide-react';
import { Panel, Segmented, Spinner } from '@komogon/ui';
import type { GlobalStats, LeaderboardEntry, LeaderboardScope } from '../../lib/api';
import { fmtDate, fmtHours } from '../../lib/format';
import { useLeaderboard, useLeaderboardStats } from '../../lib/queries';
import { ErrorPanel } from '../ErrorState';
import { Avatar } from './Avatar';
import { CompareBento } from './CompareBento';

const to = (e: LeaderboardEntry) => (e.you ? '/profile' : `/profile/${e.userId}`);

/** "1st", "2nd", "3rd", "4th". */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Two short bars, yours and the average, on one scale. */
function Pair({
  label,
  you,
  average,
  fmt,
  note,
}: {
  label: string;
  you: number;
  average: number;
  fmt: (v: number) => string;
  note?: string;
}) {
  const top = Math.max(1, you, average);
  return (
    <div className="vs">
      <div className="vs-head">
        <span className="vs-label">{label}</span>
        {note && <span className="vs-note">{note}</span>}
      </div>
      <div className="vs-row">
        <span className="vs-who">You</span>
        <span className="cmp-bar-track" aria-hidden>
          <span className="cmp-bar-fill is-you" style={{ width: `${(you / top) * 100}%` }} />
        </span>
        <span className="vs-value tabular">{fmt(you)}</span>
      </div>
      <div className="vs-row">
        <span className="vs-who">Average</span>
        <span className="cmp-bar-track" aria-hidden>
          <span className="cmp-bar-fill" style={{ width: `${(average / top) * 100}%` }} />
        </span>
        <span className="vs-value tabular">{fmt(average)}</span>
      </div>
    </div>
  );
}

/** You beside everyone on the board. Only what there is someone to compare with. */
function Everyone({ stats }: { stats: GlobalStats }) {
  const { week, days, sessionLength, streak, rank } = stats;
  if (!week && !sessionLength && !streak && !rank) return null;
  const weekNote = week
    ? `${week.which === 'this' ? 'This week' : 'Last week'}, ${week.people} ${week.people === 1 ? 'person' : 'people'} with 15 min or more`
    : undefined;
  return (
    <Panel as="section" className="everyone" aria-label="You and everyone">
      <div className="everyone-head">
        <h2 className="side-title">You and everyone</h2>
        <div className="everyone-chips">
          {rank && (
            <span className="chip chip-neutral">
              {ordinal(rank.position)} of {rank.of} all time
            </span>
          )}
          {week && week.people > 0 && (
            <span className="chip">
              Ahead of {Math.round(week.aheadOf * 100)}%{' '}
              {week.which === 'this' ? 'this week' : 'last week'}
            </span>
          )}
        </div>
      </div>
      <div className="everyone-grid">
        {week && (
          <Pair
            label="Focused time"
            you={week.you}
            average={week.average}
            fmt={fmtHours}
            note={weekNote}
          />
        )}
        {days && week && (
          <Pair
            label="Days studied"
            you={days.you}
            average={days.average}
            fmt={(v) => `${v}`}
            note={week.which === 'this' ? 'This week' : 'Last week'}
          />
        )}
        {sessionLength && (
          <Pair
            label="Session length"
            you={sessionLength.you}
            average={sessionLength.average}
            fmt={fmtHours}
            note="Last 28 days"
          />
        )}
        {streak && (
          <Pair
            label="Streak"
            you={streak.you}
            average={streak.average}
            fmt={(v) => `${v} ${v === 1 ? 'day' : 'days'}`}
            note="People with one running"
          />
        )}
      </div>
      {week && (
        <p className="everyone-foot">
          Week of {fmtDate(week.weekStart)}. People under 15 minutes are left out of the average.
        </p>
      )}
    </Panel>
  );
}

/** The ten people with the most focused time, by the name each chose: everyone, or your friends. */
export function LeaderboardTab() {
  const [params, setParams] = useSearchParams();
  const scope: LeaderboardScope = params.get('scope') === 'friends' ? 'friends' : 'global';
  const setScope = (next: LeaderboardScope) => {
    const p = new URLSearchParams(params);
    if (next === 'global') p.delete('scope');
    else p.set('scope', next);
    setParams(p);
  };
  const board = useLeaderboard(scope);
  const stats = useLeaderboardStats();
  const picker = (
    <div className="board-scope">
      <Segmented
        ariaLabel="Which board"
        value={scope}
        onChange={setScope}
        options={[
          { value: 'global', label: 'Global' },
          { value: 'friends', label: 'Friends' },
        ]}
      />
    </div>
  );
  if (board.isError)
    return <ErrorPanel message="The leaderboard could not load." onRetry={() => board.refetch()} />;
  if (!board.data)
    return (
      <div className="flex justify-center p-8">
        <Spinner />
      </div>
    );
  const entries = board.data.entries;
  const top = entries[0]?.focusMinutes ?? 1;

  return (
    <div className="board">
      {picker}
      <Panel as="section" className="board-list" aria-label="Leaderboard">
        <p className="rc-tile-note board-note">
          {scope === 'friends'
            ? 'Most focused time among you and your friends, all time.'
            : 'Most focused time, all time. Top ten.'}
        </p>
        {entries.length === 0 ? (
          <p className="text-sm">
            {scope === 'friends'
              ? 'No friends on the board yet. Add a few beside the feed.'
              : 'No finished sessions yet. Yours could be the first.'}
          </p>
        ) : (
          <ol className="board-rows">
            {entries.map((e) => (
              <li key={e.userId} className={`board-row${e.you ? ' is-you' : ''}`}>
                <span className="board-rank tabular">{e.rank}</span>
                <Link to={to(e)} className="board-who">
                  <Avatar name={e.name} url={e.avatarUrl} size="xs" />
                  <span className="board-name">{e.you ? 'You' : e.name}</span>
                  {e.rank === 1 && <Crown size={13} aria-hidden className="jam-crown" />}
                  {e.friend && scope === 'global' && (
                    <span className="chip chip-neutral">Friend</span>
                  )}
                </Link>
                <span className="cmp-bar-track" aria-hidden>
                  <span
                    className="cmp-bar-fill"
                    style={{ width: `${(e.focusMinutes / Math.max(1, top)) * 100}%` }}
                  />
                </span>
                <span className="board-hours tabular">{fmtHours(e.focusMinutes)}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
      {scope === 'global' ? stats.data && <Everyone stats={stats.data} /> : <CompareBento />}
    </div>
  );
}
