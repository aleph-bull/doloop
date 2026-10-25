import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Panel } from '@komogon/ui';
import type { LiveMember, Person } from '../../lib/api';
import { Avatar } from './Avatar';
import { named } from '../../lib/rolls';

const unknown = (id: string): Person => ({
  id,
  name: 'Someone',
  username: null,
  avatarUrl: null,
  university: null,
});

/** A clock running since the session began, ticking every second. */
export function Elapsed({ since, resting }: { since: string; resting?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <span className={`live-clock tabular${resting ? ' is-resting' : ''}`}>
      {h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`}
    </span>
  );
}

/** "12 min", then "1.5 h" like the leaderboard: how long they've been at it, kept short. */
export function StudyingFor({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const m = Math.max(1, Math.floor((now - Date.parse(since)) / 60_000));
  return <span className="tabular">{m < 60 ? `${m} min` : `${(m / 60).toFixed(1)} h`}</span>;
}

/** "On a break" or "Paused" while not focusing; nothing while they are. */
export function liveStateLabel(l: Pick<LiveMember, 'state'>): string | null {
  return l.state === 'break' ? 'On a break' : l.state === 'paused' ? 'Paused' : null;
}

/** The clock, then a break or pause, then what they are on. */
export function LiveLine({ live }: { live: LiveMember }) {
  const state = liveStateLabel(live);
  return (
    <span className="live-line">
      <Elapsed since={live.startedAt} resting={!!state} />
      {state && <span className="live-state"> · {state}</span>}
      {live.subject && <span className="live-subject"> · {live.subject}</span>}
    </span>
  );
}

/** The red dot of someone in a session, grey while they take a break or pause. */
export function LiveDot({ live, small }: { live: Pick<LiveMember, 'state'>; small?: boolean }) {
  return (
    <span
      className={`live-dot${small ? ' is-small' : ''}${live.state && live.state !== 'focus' ? ' is-resting' : ''}`}
      aria-hidden
    />
  );
}

/** Friends in a session right now, each with their clock and what they are on. */
export function LiveNow({ live, people }: { live: LiveMember[]; people: Record<string, Person> }) {
  if (live.length === 0) return null;
  return (
    <Panel as="section" className="live" aria-label="Live now">
      <div className="live-head">
        <span className="live-dot" aria-hidden />
        <h2 className="side-title">Live now</h2>
        <span className="live-count">
          {live.length} {live.length === 1 ? 'friend' : 'friends'} locked in
        </span>
      </div>
      <ul className="live-list">
        {live.map((l) => {
          const p = people[l.userId] ?? unknown(l.userId);
          return (
            <li key={l.userId} className="live-row">
              <Link to={`/profile/${l.userId}`} className="live-avatar" aria-label={p.name}>
                <Avatar name={p.name} url={p.avatarUrl} size="sm" />
                <LiveDot live={l} small />
              </Link>
              <span className="live-text">
                <Link to={`/profile/${l.userId}`} className={named('post-name', p.nameTier)}>
                  {p.name}
                </Link>
                <LiveLine live={l} />
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
