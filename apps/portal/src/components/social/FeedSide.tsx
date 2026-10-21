import { useState } from 'react';
import { Link } from 'react-router';
import { universityById } from '@komogon/core';
import { ChevronRight, Flame, SlidersHorizontal, Trophy, Users } from 'lucide-react';
import { Panel, Spinner } from '@komogon/ui';
import type { LeaderboardScope } from '../../lib/api';
import { fmtHours } from '../../lib/format';
import { useAvatar, useFriends, useLeaderboard, useMe } from '../../lib/queries';
import { Avatar } from './Avatar';

/** How many rows the small board on the feed shows. */
const MINI_ROWS = 5;

/** You, beside the feed: picture, name, university, and the few numbers people glance at. */
export function ProfileCard() {
  const user = useMe().data?.user;
  const avatar = useAvatar().data?.dataUrl ?? null;
  const friends = useFriends().data?.friends.length ?? 0;
  if (!user) return null;
  const name = user.settings.profile.name?.trim() || 'Someone';
  const uni = universityById(user.settings.profile.university);
  return (
    <Panel as="aside" className="side-card" aria-label="You">
      <Link to="/profile" className="side-me">
        <Avatar name={name} url={avatar} size="sm" />
        <span className="side-name">{name}</span>
        {uni && <span className="side-uni">{uni.name}</span>}
      </Link>
      <ul className="side-stats">
        <li>
          <Flame size={14} aria-hidden />
          <span className="tabular">{user.streak.current}</span>
          <span className="side-stat-label">{user.streak.current === 1 ? 'day' : 'days'}</span>
        </li>
        <li>
          <Trophy size={14} aria-hidden />
          <span className="tabular">{user.level}</span>
          <span className="side-stat-label">level</span>
        </li>
        <li>
          <Users size={14} aria-hidden />
          <span className="tabular">{friends}</span>
          <span className="side-stat-label">{friends === 1 ? 'friend' : 'friends'}</span>
        </li>
      </ul>
      <Link to="/settings#social" className="side-link">
        <SlidersHorizontal size={14} aria-hidden />
        What you share
      </Link>
    </Panel>
  );
}

/** The first few of a leaderboard, beside the feed, with the way to the whole board. */
export function MiniLeaderboard() {
  const [scope, setScope] = useState<LeaderboardScope>('global');
  const board = useLeaderboard(scope);
  const entries = board.data?.entries ?? [];
  return (
    <Panel as="aside" className="side-card" aria-label="Leaderboard">
      <div className="side-head">
        <h2 className="side-title">Leaderboard</h2>
        <div className="side-scope" role="group" aria-label="Which board">
          {(['global', 'friends'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className="side-scope-item"
              aria-pressed={scope === s}
              onClick={() => setScope(s)}
            >
              {s === 'global' ? 'Global' : 'Friends'}
            </button>
          ))}
        </div>
      </div>
      {board.isPending ? (
        <Spinner />
      ) : entries.length === 0 ? (
        <p className="muted text-sm">
          {scope === 'friends' ? 'No friends on it yet.' : 'No finished sessions yet.'}
        </p>
      ) : (
        <ol className="side-board">
          {entries.slice(0, MINI_ROWS).map((e) => (
            <li key={e.userId} className={`side-board-row${e.you ? ' is-you' : ''}`}>
              <span className="side-board-rank tabular">{e.rank}</span>
              <Link to={e.you ? '/profile' : `/profile/${e.userId}`} className="side-board-who">
                <Avatar name={e.name} url={e.avatarUrl} size="xs" />
                <span className="side-board-name">{e.you ? 'You' : e.name}</span>
              </Link>
              <span className="side-board-hours tabular">{fmtHours(e.focusMinutes)}</span>
            </li>
          ))}
        </ol>
      )}
      <Link to={`/social?tab=leaderboard&scope=${scope}`} className="side-link">
        See the board
        <ChevronRight size={14} aria-hidden />
      </Link>
    </Panel>
  );
}
