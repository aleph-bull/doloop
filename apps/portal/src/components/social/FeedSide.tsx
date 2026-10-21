import { useDeferredValue, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { universityById } from '@komogon/core';
import {
  Check,
  ChevronRight,
  Flame,
  Search,
  SlidersHorizontal,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { Panel, Spinner, useToast } from '@komogon/ui';
import type { LeaderboardScope, Person } from '../../lib/api';
import { fmtHours } from '../../lib/format';
import {
  useAcceptFriendRequest,
  useAvatar,
  useDeleteFriendRequest,
  useFindPeople,
  useFriends,
  useLeaderboard,
  useMe,
  useRemoveFriend,
  useSendFriendRequest,
} from '../../lib/queries';
import { Avatar } from './Avatar';

const unknown = (id: string): Person => ({
  id,
  name: 'Someone',
  avatarUrl: null,
  university: null,
});

/** A small round button on a person's row: accept, decline, remove. */
function RowButton({
  label,
  onClick,
  busy,
  tone,
  children,
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  tone?: 'yes';
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`side-row-btn${tone === 'yes' ? ' is-yes' : ''}`}
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function PersonRow({ person, children }: { person: Person; children?: ReactNode }) {
  return (
    <li className="side-person">
      <Link to={`/profile/${person.id}`} className="side-person-link">
        <Avatar name={person.name} url={person.avatarUrl} size="xs" />
        <span className="side-person-name">{person.name}</span>
      </Link>
      <span className="side-person-actions">{children}</span>
    </li>
  );
}

/** Friends, under your card: requests to answer, the list, and a box to find more. */
export function FriendsCard() {
  const q = useFriends();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query.trim());
  const found = useFindPeople(deferred);
  const accept = useAcceptFriendRequest();
  const decline = useDeleteFriendRequest();
  const remove = useRemoveFriend();
  const send = useSendFriendRequest();
  const { toast } = useToast();
  const fail = (err: unknown) => toast(err instanceof Error ? err.message : 'Could not do that');
  const data = q.data;
  const who = (id: string) => data?.people[id] ?? found.data?.people[id] ?? unknown(id);

  return (
    <Panel as="aside" className="side-card" aria-label="Friends">
      <div className="side-head">
        <h2 className="side-title">
          Friends
          {data && data.friends.length > 0 && (
            <span className="side-count tabular">{data.friends.length}</span>
          )}
        </h2>
      </div>
      <label className="side-search">
        <Search size={14} aria-hidden />
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find people"
          aria-label="Find people by name"
        />
      </label>
      {deferred && (
        <ul className="side-people">
          {found.isPending ? (
            <li className="muted text-xs">Looking…</li>
          ) : found.data?.results.length === 0 ? (
            <li className="muted text-xs">No one by that name.</li>
          ) : (
            found.data?.results.map((r) => (
              <PersonRow key={r.userId} person={who(r.userId)}>
                {r.friendship.status === 'friends' ? (
                  <span className="side-person-note">Friends</span>
                ) : r.friendship.status === 'requested' ? (
                  <span className="side-person-note">Asked</span>
                ) : r.friendship.status === 'incoming' ? (
                  <span className="side-person-note">Asked you</span>
                ) : !r.acceptsRequests ? (
                  <span className="side-person-note">Not taking requests</span>
                ) : (
                  <button
                    type="button"
                    className="side-add"
                    disabled={send.isPending}
                    onClick={() => send.mutate(r.userId, { onError: fail })}
                  >
                    Add
                  </button>
                )}
              </PersonRow>
            ))
          )}
        </ul>
      )}
      {!data ? (
        <Spinner />
      ) : (
        <>
          {data.friends.length === 0 ? (
            !deferred && <p className="muted text-xs">No friends yet. Search above.</p>
          ) : (
            <ul className="side-people">
              {data.friends.map((f) => (
                <PersonRow key={f.userId} person={who(f.userId)}>
                  <RowButton
                    label="Remove friend"
                    busy={remove.isPending}
                    onClick={() => remove.mutate(f.userId, { onError: fail })}
                  >
                    <X size={13} aria-hidden />
                  </RowButton>
                </PersonRow>
              ))}
            </ul>
          )}
          {data.incoming.length > 0 && (
            <>
              <p className="side-label">Requests to answer</p>
              <ul className="side-people is-requests">
                {data.incoming.map((r) => (
                  <PersonRow key={r.id} person={who(r.userId)}>
                    <RowButton
                      label="Accept"
                      tone="yes"
                      busy={accept.isPending}
                      onClick={() => accept.mutate(r.id, { onError: fail })}
                    >
                      <Check size={13} aria-hidden />
                    </RowButton>
                    <RowButton
                      label="Decline"
                      busy={decline.isPending}
                      onClick={() => decline.mutate(r.id, { onError: fail })}
                    >
                      <X size={13} aria-hidden />
                    </RowButton>
                  </PersonRow>
                ))}
              </ul>
            </>
          )}
          {data.outgoing.length > 0 && (
            <>
              <p className="side-label">Asked</p>
              <ul className="side-people">
                {data.outgoing.map((r) => (
                  <PersonRow key={r.id} person={who(r.userId)}>
                    <RowButton
                      label="Take the request back"
                      busy={decline.isPending}
                      onClick={() => decline.mutate(r.id, { onError: fail })}
                    >
                      <X size={13} aria-hidden />
                    </RowButton>
                  </PersonRow>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Panel>
  );
}

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
