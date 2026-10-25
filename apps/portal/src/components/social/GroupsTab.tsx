import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { BellRing, Hash, LogOut, Plus } from 'lucide-react';
import { Button, Panel, Spinner, useToast } from '@komogon/ui';
import type { Group, Person } from '../../lib/api';
import { fmtDate, fmtHours } from '../../lib/format';
import {
  useCreateGroup,
  useGroups,
  useJoinGroup,
  useJoinGroupByCode,
  useLeaveGroup,
  useMe,
  useNudge,
} from '../../lib/queries';
import { ErrorPanel } from '../ErrorState';
import { Avatar } from './Avatar';
import { DayLines, hm } from './DayLines';
import { LiveNow } from './LiveNow';
import { named } from '../../lib/rolls';

const unknown = (id: string): Person => ({
  id,
  name: 'Someone',
  username: null,
  avatarUrl: null,
  university: null,
});

/** What someone put the time into: a segment per task, and the names under it. */
export function Subjects({
  subjects,
  top,
}: {
  subjects: Array<{ title: string; minutes: number }>;
  top: number;
}) {
  if (subjects.length === 0) return null;
  return (
    <span className="group-subjects">
      <span className="group-segments" aria-hidden>
        {subjects.map((s, j) => (
          <span
            key={s.title}
            className={`group-seg is-${j}`}
            style={{ width: `${(s.minutes / Math.max(1, top)) * 100}%` }}
          />
        ))}
      </span>
      <span className="group-legend">
        {subjects.map((s, j) => (
          <span key={s.title} className="group-legend-item">
            <span className={`group-swatch is-${j}`} aria-hidden />
            {s.title} <span className="tabular">{fmtHours(s.minutes)}</span>
          </span>
        ))}
      </span>
    </span>
  );
}

/** One group's last seven days: the total together, the lines, and everyone ranked. */
function GroupCard({ group, people }: { group: Group; people: Record<string, Person> }) {
  const me = useMe().data?.user.id ?? '';
  const join = useJoinGroup();
  const leave = useLeaveGroup();
  const nudge = useNudge();
  const { toast } = useToast();
  const fail = (err: unknown) => toast(err instanceof Error ? err.message : 'Could not do that');
  const days = group.days ?? [];
  const first = days[0];
  const last = days[days.length - 1];
  const top = Math.max(1, ...group.members.map((m) => m.minutes));
  const average = group.members.length ? group.totalMinutes / group.members.length : 0;
  const span =
    days.length === 7 ? 'last 7 days' : first === last ? 'since today' : `since ${fmtDate(first)}`;

  return (
    <Panel as="section" className="group" aria-label={group.name}>
      <header className="group-head">
        <div className="group-title-wrap">
          <h2 className="group-title">
            {group.name} <span className="group-title-sub">· {span}</span>
          </h2>
          <p className="group-meta">
            {group.members.length} {group.members.length === 1 ? 'person' : 'people'}
            {group.code && (
              <>
                {' '}
                · code <span className="jam-code-chip tabular">{group.code}</span>
              </>
            )}
          </p>
        </div>
        <div className="group-total">
          <span className="group-total-figure tabular">{hm(group.totalMinutes)}</span>
          <span className="group-total-label">together</span>
        </div>
        {group.you ? (
          <Button
            icon
            size="sm"
            variant="ghost"
            aria-label="Leave the group"
            title="Leave"
            loading={leave.isPending}
            onClick={() => leave.mutate(group.id, { onError: fail })}
          >
            <LogOut size={15} aria-hidden />
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            loading={join.isPending}
            onClick={() => join.mutate(group.id, { onError: fail })}
          >
            Join
          </Button>
        )}
      </header>
      {group.live.length > 0 && (
        <p className="group-live">
          <span className="live-dot is-small" aria-hidden />
          {group.live.map((l) => (people[l.userId] ?? unknown(l.userId)).name).join(', ')}{' '}
          {group.live.length === 1 ? 'is' : 'are'} studying now
        </p>
      )}
      <div className="group-body">
        <DayLines
          days={days}
          series={group.members.map((m) => ({ id: m.userId, values: m.byDay ?? [] }))}
          youId={me}
        />
        <ol className="group-rows">
          {group.members.map((m, i) => {
            const p = people[m.userId] ?? unknown(m.userId);
            const you = m.userId === me;
            const quiet = !you && m.nudgeable && group.you && m.minutes < average / 2;
            return (
              <li key={m.userId} className={`group-row${you ? ' is-you' : ''}`}>
                <span className="jam-rank tabular">{i + 1}</span>
                <Link to={you ? '/profile' : `/profile/${m.userId}`} aria-label={p.name}>
                  <Avatar name={p.name} url={p.avatarUrl} size="xs" />
                </Link>
                <span className="group-who">
                  <span className="group-name-line">
                    <Link
                      to={you ? '/profile' : `/profile/${m.userId}`}
                      className={named('jam-name', p.nameTier)}
                    >
                      {you ? 'You' : p.name}
                    </Link>
                    {quiet && (
                      <button
                        type="button"
                        className="group-nudge"
                        disabled={nudge.isPending}
                        onClick={() =>
                          nudge.mutate(
                            { userId: m.userId, groupId: group.id },
                            { onSuccess: () => toast(`Nudged ${p.name}.`), onError: fail },
                          )
                        }
                      >
                        <BellRing size={11} aria-hidden /> Nudge
                      </button>
                    )}
                  </span>
                  <Subjects subjects={m.subjects} top={top} />
                </span>
                <span className="group-minutes tabular">{m.minutes > 0 ? hm(m.minutes) : '–'}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </Panel>
  );
}

function Starter() {
  const create = useCreateGroup();
  const joinByCode = useJoinGroupByCode();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const fail = (err: unknown) => toast(err instanceof Error ? err.message : 'Could not do that');
  const start = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(name.trim(), { onSuccess: () => setName(''), onError: fail });
  };
  const join = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c.length !== 6) return;
    joinByCode.mutate(c, { onSuccess: () => setCode(''), onError: fail });
  };
  return (
    <div className="jam-starter">
      <Panel as="form" className="jam-form" onSubmit={start} aria-label="Start a group">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 40))}
          placeholder="Name your group"
          aria-label="Group name"
        />
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={!name.trim()}
          loading={create.isPending}
        >
          <Plus size={14} aria-hidden /> Start
        </Button>
      </Panel>
      <Panel as="form" className="jam-form is-code" onSubmit={join} aria-label="Join with a code">
        <Hash size={15} aria-hidden className="muted" />
        <input
          className="input jam-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
          placeholder="Code"
          aria-label="Group code"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={code.trim().length !== 6}
          loading={joinByCode.isPending}
        >
          Join
        </Button>
      </Panel>
    </div>
  );
}

/** Study groups: who is live, and each group's last seven days with everyone ranked. */
export function GroupsTab() {
  const q = useGroups();
  if (q.isError)
    return <ErrorPanel message="Could not load the groups." onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <div className="flex justify-center p-8">
        <Spinner />
      </div>
    );
  const { groups, open, live, people } = q.data;
  return (
    <div className="jams">
      <Starter />
      <LiveNow live={live} people={people} />
      {groups.length === 0 && open.length === 0 && (
        <p className="muted text-sm jam-empty">
          A group is a few friends who study alongside each other. Start one, pass the code on, and
          the week shows up here for all of you.
        </p>
      )}
      {groups.map((g) => (
        <GroupCard key={g.id} group={g} people={people} />
      ))}
      {open.length > 0 && (
        <>
          <h2 className="jam-section">Friends are in</h2>
          {open.map((g) => (
            <GroupCard key={g.id} group={g} people={people} />
          ))}
        </>
      )}
    </div>
  );
}
