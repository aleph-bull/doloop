import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck } from 'lucide-react';
import { Panel, Segmented, Spinner, Toggle } from '@komogon/ui';
import { api } from '../../lib/api';
import { useMe, useUpdateSettings } from '../../lib/queries';
import { fmtHours } from '../../lib/format';
import { ErrorPanel } from '../ErrorState';
import { UniversityField } from '../ProfileFields';
import { Avatar } from './Avatar';
import { LiveLine } from './LiveNow';
import { PostCard } from './PostCard';
import { SchoolMark } from './SchoolMark';

export function SchoolRankings() {
  const [period, setPeriod] = useState<'week' | 'all'>('week');
  const board = useQuery({
    queryKey: ['schools', 1, 'rankings', period],
    queryFn: () => api.schoolLeaderboard(period),
    refetchInterval: 60_000,
  });
  return (
    <Panel as="section" className="school-rankings">
      <div className="school-heading">
        <h2>School rankings</h2>
        <Segmented
          ariaLabel="School ranking period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'week', label: 'This week' },
            { value: 'all', label: 'All time' },
          ]}
        />
      </div>
      {board.isError ? (
        <ErrorPanel message="School rankings could not load." onRetry={() => board.refetch()} />
      ) : !board.data ? (
        <Spinner />
      ) : !board.data.entries.length ? (
        <p className="muted">No finished sessions yet.</p>
      ) : (
        <ol className="school-board">
          {board.data.entries.map((e) => (
            <li key={e.school.id} className={e.you ? 'is-you' : ''}>
              <span className="tabular">{e.rank}</span>
              <SchoolMark school={e.school} />
              <div className="school-person">
                <strong>{e.school.short ?? e.school.name}</strong>
                <span className="muted text-sm">
                  {e.members} {e.members === 1 ? 'contributor' : 'contributors'}
                  {e.you ? ' · Your school' : ''}
                </span>
              </div>
              <strong className="tabular">
                {fmtHours(e.focusMinutes)}
                <small className="school-focus-label">focus</small>
              </strong>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export function SchoolTab() {
  const q = useQuery({
    queryKey: ['schools', 1, 'community'],
    queryFn: api.schoolCommunity,
    refetchInterval: 30_000,
  });
  const me = useMe();
  const update = useUpdateSettings();
  if (q.isError)
    return <ErrorPanel message="Your school could not load." onRetry={() => q.refetch()} />;
  if (!q.data) return <Spinner />;
  const { school, live, posts, people } = q.data;
  return (
    <div className="school-layout">
      <div className="school-main">
        <Panel as="section">
          {school ? (
            <>
              <div className="school-heading">
                <SchoolMark school={school} />
                <h2>{school.name}</h2>
                <BadgeCheck size={18} aria-label="Verified school" />
              </div>
              <Toggle
                checked={me.data?.user.settings.social.schoolActivity ?? false}
                disabled={update.isPending}
                label="Share study activity with my school"
                description="Your current session and public posts. Your email stays private."
                onChange={(schoolActivity) => update.mutate({ social: { schoolActivity } })}
              />
              <div className="school-actions">
                <Link to="/social?tab=leaderboard&scope=school" className="btn btn-secondary">
                  School leaderboard
                </Link>
                <Link to="/profile" className="link-button">
                  Your profile
                </Link>
              </div>
            </>
          ) : (
            <>
              <h2>Verify your school</h2>
              <UniversityField active />
              <p className="muted text-sm">
                Can't find your school?{' '}
                <a
                  className="link-button"
                  href="https://github.com/Hipo/university-domains-list"
                  target="_blank"
                  rel="noreferrer"
                >
                  School directory
                </a>
              </p>
            </>
          )}
        </Panel>
        {school && (
          <Panel as="section">
            <h2>Studying now</h2>
            {live.length ? (
              <ul className="school-live-list">
                {live.map((l) => {
                  const person = people[l.userId];
                  return (
                    person && (
                      <li key={l.userId}>
                        <Link to={`/profile/${person.id}`}>
                          <Avatar name={person.name} url={person.avatarUrl} size="sm" />
                        </Link>
                        <div className="school-person">
                          <Link to={`/profile/${person.id}`} className="post-name">
                            {person.name}
                          </Link>
                          <LiveLine live={l} />
                        </div>
                      </li>
                    )
                  );
                })}
              </ul>
            ) : (
              <p className="muted">No shared sessions right now.</p>
            )}
          </Panel>
        )}
        {school && (
          <section className="school-posts">
            <h2>From your school</h2>
            {posts.length ? (
              posts.map((post) => <PostCard key={post.id} post={post} people={people} />)
            ) : (
              <Panel>
                <p className="muted">No shared posts yet.</p>
              </Panel>
            )}
          </section>
        )}
      </div>
      <SchoolRankings />
    </div>
  );
}
