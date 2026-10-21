import { Link } from 'react-router';
import { BellRing, X } from 'lucide-react';
import { Panel } from '@komogon/ui';
import { fmtAgo } from '../lib/format';
import { useNudges, useNudgesSeen } from '../lib/queries';
import { Avatar } from './social/Avatar';

/** Friends who nudged you to study in the last day, on the dashboard until waved away. */
export function NudgesCard() {
  const q = useNudges();
  const seen = useNudgesSeen();
  const list = q.data?.nudges ?? [];
  if (list.length === 0) return null;
  const people = q.data?.people ?? {};
  return (
    <Panel as="section" className="nudges" aria-label="Nudges">
      <div className="nudges-head">
        <BellRing size={15} aria-hidden className="nudges-icon" />
        <span className="nudges-title">
          {list.length === 1 ? 'A nudge to study' : `${list.length} nudges to study`}
        </span>
        <button
          type="button"
          className="side-row-btn"
          aria-label="Got it"
          title="Got it"
          onClick={() => seen.mutate()}
        >
          <X size={13} aria-hidden />
        </button>
      </div>
      <ul className="nudges-list">
        {list.map((n) => {
          const p = people[n.fromId];
          const name = p?.name ?? 'Someone';
          return (
            <li key={n.id} className="nudges-row">
              <Link to={`/profile/${n.fromId}`} aria-label={name}>
                <Avatar name={name} url={p?.avatarUrl ?? null} size="xs" />
              </Link>
              <span className="nudges-text">
                <Link to={`/profile/${n.fromId}`} className="post-name">
                  {name}
                </Link>{' '}
                nudged you{n.groupName ? ` from ${n.groupName}` : ''}
              </span>
              <span className="post-when">{fmtAgo(n.at)}</span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
