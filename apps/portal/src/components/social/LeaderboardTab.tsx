import { Link, useSearchParams } from 'react-router';
import { Crown, Flame } from 'lucide-react';
import type { Board } from '@komogon/core';
import { Panel, Segmented, Sparkline, Spinner } from '@komogon/ui';
import type { GlobalStats, LeaderboardEntry } from '../../lib/api';
import { ApiError } from '../../lib/api';
import { fmtDate, fmtHours } from '../../lib/format';
import { useBoards, useLeaderboard, useLeaderboardStats } from '../../lib/queries';
import { ErrorPanel } from '../ErrorState';
import { Avatar } from './Avatar';
import { CompareBento } from './CompareBento';
import { SchoolRankings } from './SchoolTab';
import { named } from '../../lib/rolls';

const to = (e: LeaderboardEntry) => (e.you ? '/profile' : `/profile/${e.userId}`);

const BOARD_LABELS: Record<Board, string> = {
  global: 'Global',
  friends: 'Friends',
  school: 'My school',
  schools: 'Schools',
};

/** "1st", "2nd", "3rd", "4th". */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Minutes as a big number with a small unit. */
function Figure({ minutes }: { minutes: number }) {
  const [value, unit] =
    minutes < 60
      ? [String(Math.round(minutes)), 'min']
      : [
          String(minutes / 60 >= 100 ? Math.round(minutes / 60) : Math.round(minutes / 6) / 10),
          'h',
        ];
  return (
    <span className="lb-figure tabular">
      {value}
      <small>{unit}</small>
    </span>
  );
}

/** The first three as tiles: the all-time total big, the last eight weeks as a line. */
function TopTile({ e }: { e: LeaderboardEntry }) {
  return (
    <Panel as="li" className={`lb-tile${e.you ? ' is-you' : ''}`}>
      <div className="lb-tile-head">
        <span className="lb-rank-badge tabular">{e.rank}</span>
        <Link to={to(e)} className="lb-who">
          <Avatar name={e.name} url={e.avatarUrl} size="sm" />
          <span className="lb-name-wrap">
            <span className={named('lb-name', e.nameTier)}>{e.you ? 'You' : e.name}</span>
            <span className="lb-sub">
              {e.rank === 1 && <Crown size={12} aria-hidden className="jam-crown" />}
              {e.friend && !e.you ? 'Friend' : e.you ? 'Your place' : ordinal(e.rank)}
            </span>
          </span>
        </Link>
      </div>
      <div className="lb-tile-body">
        <div className="lb-tile-figure">
          <Figure minutes={e.focusMinutes} />
          <span className="lb-tile-label">all time</span>
        </div>
        <Sparkline
          values={e.weekly ?? []}
          label={`${e.name}'s minutes per week over the last eight weeks`}
          width={150}
          height={40}
        />
      </div>
      <div className="lb-tile-foot">
        <span>
          <span className="tabular">{fmtHours(e.thisWeek)}</span> this week
        </span>
        <span>
          <span className="tabular">{e.activeDays28}</span> of 28 days
        </span>
        {e.streak > 0 && (
          <span className="lb-streak">
            <Flame size={12} aria-hidden />
            <span className="tabular">{e.streak}</span>
          </span>
        )}
      </div>
    </Panel>
  );
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
      <div className="everyone-body">
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
        </div>
        {(sessionLength || streak) && (
          <div className="everyone-figures">
            {sessionLength && (
              <div className="everyone-figure">
                <span className="everyone-figure-label">Session length</span>
                <Figure minutes={sessionLength.you} />
                <span className="everyone-figure-note">
                  average {fmtHours(sessionLength.average)} · last 28 days
                </span>
              </div>
            )}
            {streak && (
              <div className="everyone-figure">
                <span className="everyone-figure-label">Streak</span>
                <span className="lb-figure tabular">
                  {streak.you}
                  <small>{streak.you === 1 ? 'day' : 'days'}</small>
                </span>
                <span className="everyone-figure-note">
                  average {streak.average} among people with one running
                </span>
              </div>
            )}
          </div>
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

/**
 * The ten people with the most focused time: the first three as tiles with their last eight
 * weeks, the rest as rows with the same line small, this week and the all-time total.
 */
export function LeaderboardTab() {
  const [params, setParams] = useSearchParams();
  // Only the boards Settings › Pages › Social › Comparisons keeps; a link to another opens the first.
  const boards = useBoards();
  const rawScope = params.get('scope') as Board | null;
  const scope: Board = rawScope && boards.includes(rawScope) ? rawScope : (boards[0] ?? 'global');
  const setScope = (next: Board) => {
    const p = new URLSearchParams(params);
    if (next === 'global') p.delete('scope');
    else p.set('scope', next);
    setParams(p);
  };
  const board = useLeaderboard(scope === 'schools' ? 'global' : scope, scope !== 'schools');
  const stats = useLeaderboardStats(scope === 'global');
  const picker = boards.length > 1 && (
    <div className="board-scope">
      <Segmented
        ariaLabel="Which board"
        value={scope}
        onChange={setScope}
        options={boards.map((b) => ({ value: b, label: BOARD_LABELS[b] }))}
      />
    </div>
  );
  if (scope === 'schools')
    return (
      <div className="board">
        {picker}
        <SchoolRankings />
      </div>
    );
  if (
    board.isError &&
    scope === 'school' &&
    board.error instanceof ApiError &&
    board.error.status === 403
  )
    return (
      <div className="board">
        {picker}
        <Panel>
          <p>Verify your school email to see this board.</p>
          <Link to="/social?tab=school" className="btn btn-secondary">
            Verify school
          </Link>
        </Panel>
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
  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);

  return (
    <div className="board">
      {picker}
      {entries.length === 0 ? (
        <Panel className="p-5">
          <p className="text-sm">
            {scope === 'friends'
              ? 'No friends on the board yet. Add a few beside the feed.'
              : 'No finished sessions yet. Yours could be the first.'}
          </p>
        </Panel>
      ) : (
        <>
          <ol className="lb-top">
            {top3.map((e) => (
              <TopTile key={e.userId} e={e} />
            ))}
          </ol>
          {rest.length > 0 && (
            <Panel as="section" className="board-list" aria-label="Fourth onwards">
              <ol className="lb-rows" start={4}>
                {rest.map((e) => (
                  <li key={e.userId} className={`lb-row${e.you ? ' is-you' : ''}`}>
                    <span className="board-rank tabular">{e.rank}</span>
                    <Link to={to(e)} className="board-who">
                      <Avatar name={e.name} url={e.avatarUrl} size="xs" />
                      <span className={named('board-name', e.nameTier)}>
                        {e.you ? 'You' : e.name}
                      </span>
                      {e.friend && scope === 'global' && (
                        <span className="chip chip-neutral">Friend</span>
                      )}
                    </Link>
                    <span className="lb-row-spark">
                      <Sparkline
                        values={e.weekly ?? []}
                        label={`${e.name}'s minutes per week over the last eight weeks`}
                        width={110}
                        height={26}
                      />
                    </span>
                    <span className="lb-row-week">
                      <span className="tabular">{fmtHours(e.thisWeek)}</span>
                      <span className="lb-row-label">this week</span>
                    </span>
                    <span className="lb-row-streak">
                      {e.streak > 0 && (
                        <>
                          <Flame size={12} aria-hidden />
                          <span className="tabular">{e.streak}</span>
                        </>
                      )}
                    </span>
                    <span className="board-hours tabular">{fmtHours(e.focusMinutes)}</span>
                  </li>
                ))}
              </ol>
            </Panel>
          )}
        </>
      )}
      {scope === 'global' ? (
        stats.data && <Everyone stats={stats.data} />
      ) : scope === 'friends' ? (
        <CompareBento />
      ) : null}
    </div>
  );
}
