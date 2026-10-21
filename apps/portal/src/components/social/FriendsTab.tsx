import { useDeferredValue, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Search } from 'lucide-react';
import { Panel, Spinner } from '@komogon/ui';
import type { Person } from '../../lib/api';
import { useFindPeople, useFriends } from '../../lib/queries';
import { ErrorPanel } from '../ErrorState';
import { Avatar } from './Avatar';
import { FriendButton } from './FriendButton';

const unknown = (id: string): Person => ({
  id,
  name: 'Someone',
  avatarUrl: null,
  university: null,
});

/** One person in a list: picture, name, university, and what to do about them on the right. */
function PersonRow({ person, note, action }: { person: Person; note?: string; action: ReactNode }) {
  return (
    <li className="person-row">
      <Link to={`/profile/${person.id}`} className="person-link">
        <Avatar name={person.name} url={person.avatarUrl} size="sm" />
        <span className="person-text">
          <span className="person-name">{person.name}</span>
          <span className="person-note">
            {person.university?.short ?? person.university?.name ?? ''}
            {person.university && note ? ' · ' : ''}
            {note}
          </span>
        </span>
      </Link>
      <span className="person-action">{action}</span>
    </li>
  );
}

function since(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(
    new Date(iso),
  );
}

/** Requests waiting on you, your friends, the ones you have asked, and a way to find more. */
export function FriendsTab() {
  const q = useFriends();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query.trim());
  const found = useFindPeople(deferred);

  if (q.isError)
    return <ErrorPanel message="Could not load your friends." onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <div className="flex justify-center p-8">
        <Spinner />
      </div>
    );
  const { friends, incoming, outgoing, people } = q.data;
  const who = (id: string) => people[id] ?? found.data?.people[id] ?? unknown(id);

  return (
    <div className="friends">
      <Panel as="section" className="friends-section" aria-label="Find people">
        <label className="friends-search">
          <Search size={16} aria-hidden />
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find people by name"
            aria-label="Find people by name"
          />
        </label>
        {deferred && (
          <ul className="person-list">
            {found.isPending ? (
              <li className="muted text-sm">Looking…</li>
            ) : found.data?.results.length === 0 ? (
              <li className="muted text-sm">No one by that name.</li>
            ) : (
              found.data?.results.map((r) => (
                <PersonRow
                  key={r.userId}
                  person={found.data.people[r.userId] ?? unknown(r.userId)}
                  action={
                    <FriendButton
                      userId={r.userId}
                      friendship={r.friendship}
                      acceptsRequests={r.acceptsRequests}
                    />
                  }
                />
              ))
            )}
          </ul>
        )}
      </Panel>

      {incoming.length > 0 && (
        <Panel as="section" className="friends-section" aria-label="Requests">
          <h2 className="rc-tile-title">
            Requests <span className="friends-count tabular">{incoming.length}</span>
          </h2>
          <ul className="person-list">
            {incoming.map((r) => (
              <PersonRow
                key={r.id}
                person={who(r.userId)}
                action={
                  <FriendButton
                    userId={r.userId}
                    friendship={{ status: 'incoming', requestId: r.id }}
                  />
                }
              />
            ))}
          </ul>
        </Panel>
      )}

      <Panel as="section" className="friends-section" aria-label="Friends">
        <h2 className="rc-tile-title">
          Friends{' '}
          {friends.length > 0 && <span className="friends-count tabular">{friends.length}</span>}
        </h2>
        {friends.length === 0 ? (
          <p className="muted text-sm">
            No friends yet. Search above, or add people from the leaderboard and the feed.
          </p>
        ) : (
          <ul className="person-list">
            {friends.map((f) => (
              <PersonRow
                key={f.userId}
                person={who(f.userId)}
                note={`Since ${since(f.since)}`}
                action={
                  <FriendButton
                    userId={f.userId}
                    friendship={{ status: 'friends', requestId: null }}
                    remove
                  />
                }
              />
            ))}
          </ul>
        )}
      </Panel>

      {outgoing.length > 0 && (
        <Panel as="section" className="friends-section" aria-label="Sent">
          <h2 className="rc-tile-title">Sent</h2>
          <ul className="person-list">
            {outgoing.map((r) => (
              <PersonRow
                key={r.id}
                person={who(r.userId)}
                action={
                  <FriendButton
                    userId={r.userId}
                    friendship={{ status: 'requested', requestId: r.id }}
                  />
                }
              />
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
