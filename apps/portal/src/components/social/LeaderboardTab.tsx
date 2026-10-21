import { Link, useSearchParams } from 'react-router';
import { Panel, Segmented, Spinner } from '@komogon/ui';
import type { LeaderboardEntry, LeaderboardScope } from '../../lib/api';
import { fmtHours } from '../../lib/format';
import { useLeaderboard } from '../../lib/queries';
import { ErrorPanel } from '../ErrorState';
import { Avatar } from './Avatar';

const to = (e: LeaderboardEntry) => (e.you ? '/profile' : `/profile/${e.userId}`);

/** The first three on a small podium, the second in the middle and the first a step up. */
function Podium({ top }: { top: LeaderboardEntry[] }) {
  const order = [top[1], top[0], top[2]].filter((e): e is LeaderboardEntry => Boolean(e));
  return (
    <ol className="podium" aria-label="Top three">
      {order.map((e) => (
        <li key={e.userId} className={`podium-step is-${e.rank}${e.you ? ' is-you' : ''}`}>
          <Link to={to(e)} className="podium-person">
            <Avatar name={e.name} url={e.avatarUrl} size={e.rank === 1 ? 'md' : 'sm'} />
            <span className="podium-name">{e.you ? 'You' : e.name}</span>
            <span className="podium-hours tabular">{fmtHours(e.focusMinutes)}</span>
          </Link>
          <span className="podium-block" aria-hidden>
            <span className="podium-rank tabular">{e.rank}</span>
          </span>
        </li>
      ))}
    </ol>
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
  const board = useLeaderboard(scope);
  if (board.isError)
    return <ErrorPanel message="The leaderboard could not load." onRetry={() => board.refetch()} />;
  if (!board.data)
    return (
      <div className="flex justify-center p-8">
        <Spinner />
      </div>
    );
  const entries = board.data.entries;
  if (entries.length === 0)
    return (
      <div className="board">
        {picker}
        <Panel className="p-5">
          <p>
            {scope === 'friends'
              ? 'No friends on the board yet. Add a few in the Friends tab.'
              : 'No finished sessions yet. Yours could be the first.'}
          </p>
        </Panel>
      </div>
    );
  const top = entries[0]!.focusMinutes;
  const rest = entries.slice(3);

  return (
    <div className="board">
      {picker}
      <Panel as="section" className="board-top" aria-label="Leaderboard">
        <p className="rc-tile-note">
          {scope === 'friends'
            ? 'Most focused time among you and your friends, all time.'
            : 'Most focused time, all time. Top ten.'}
        </p>
        <Podium top={entries.slice(0, 3)} />
      </Panel>
      {rest.length > 0 && (
        <Panel as="section" className="board-list" aria-label="Fourth to tenth">
          <ol className="board-rows" start={4}>
            {rest.map((e) => (
              <li key={e.userId} className={`board-row${e.you ? ' is-you' : ''}`}>
                <span className="board-rank tabular">{e.rank}</span>
                <Link to={to(e)} className="board-who">
                  <Avatar name={e.name} url={e.avatarUrl} size="xs" />
                  <span className="board-name">{e.you ? 'You' : e.name}</span>
                  {e.friend && <span className="chip chip-neutral">Friend</span>}
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
        </Panel>
      )}
    </div>
  );
}
