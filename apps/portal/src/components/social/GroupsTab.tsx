import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { BellRing, Hash, LogOut, Plus } from 'lucide-react';
import { Button, Panel, Spinner, useToast } from '@komogon/ui';
import type { Group, GroupMemberWeek, LiveMember, Person } from '../../lib/api';
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

const unknown = (id: string): Person => ({
  id,
  name: 'Someone',
  avatarUrl: null,
  university: null,
});
const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** "1h 23m" / "45m", the way the group totals read. */
function hm(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  return h === 0 ? `${m}m` : `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

/** A clock running since the session began, ticking every second. */
function Elapsed({ since }: { since: string }) {
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
    <span className="live-clock tabular">
      {h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`}
    </span>
  );
}

/** Friends in a session right now, each with their clock and what they are on. */
function LiveNow({ live, people }: { live: LiveMember[]; people: Record<string, Person> }) {
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
                <span className="live-dot is-small" aria-hidden />
              </Link>
              <span className="live-text">
                <Link to={`/profile/${l.userId}`} className="post-name">
                  {p.name}
                </Link>
                <span className="live-line">
                  <Elapsed since={l.startedAt} />
                  {l.subject && <span className="live-subject"> · {l.subject}</span>}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** Everyone's running total through the week, one line each; yours in the accent. */
function WeekLines({
  members,
  today,
  youId,
}: {
  members: GroupMemberWeek[];
  today: number;
  youId: string;
}) {
  const W = 320;
  const H = 150;
  const padL = 6;
  const padR = 14;
  const top = 10;
  const base = H - 22;
  const max = Math.max(30, ...members.flatMap((m) => m.byDay.map((v) => v ?? 0)));
  const x = (i: number) => padL + ((W - padL - padR) * i) / 6;
  const y = (v: number) => base - ((base - top) * v) / max;
  const path = (m: GroupMemberWeek) => {
    const pts = [
      [x(0), y(0)],
      ...m.byDay
        .map((v, i) => (v === null ? null : [x(i + 1 > 6 ? 6 : i), y(v)]))
        .filter((p): p is number[] => !!p),
    ];
    return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]!.toFixed(1)},${p[1]!.toFixed(1)}`).join('');
  };
  // Days run Monday to Sunday across the width; today's point gets the dot.
  return (
    <svg
      className="group-lines"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Running totals through the week, one line per person"
    >
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line
          key={f}
          x1={padL}
          x2={W - padR}
          y1={y(max * f)}
          y2={y(max * f)}
          className="group-grid"
        />
      ))}
      {members.map((m, i) => {
        const you = m.userId === youId;
        const last = m.byDay[Math.min(today, 6)] ?? 0;
        return (
          <g
            key={m.userId}
            className={`group-line${you ? ' is-you' : ''}`}
            style={{ opacity: you ? 1 : Math.max(0.35, 0.85 - i * 0.12) }}
          >
            <path d={path(m)} />
            <circle cx={x(Math.min(today, 6))} cy={y(last)} r={3.5} />
          </g>
        );
      })}
      {DAYS.map((d, i) => (
        <text key={i} x={x(i)} y={H - 6} className="group-axis" textAnchor="middle">
          {d}
        </text>
      ))}
    </svg>
  );
}

/** One group's week: the total together, the lines, and everyone ranked with their subjects. */
function GroupCard({ group, people }: { group: Group; people: Record<string, Person> }) {
  const me = useMe().data?.user.id ?? '';
  const join = useJoinGroup();
  const leave = useLeaveGroup();
  const nudge = useNudge();
  const { toast } = useToast();
  const fail = (err: unknown) => toast(err instanceof Error ? err.message : 'Could not do that');
  const weekEnd = new Date(Date.parse(group.weekStart) + 6 * 86_400_000).toISOString();
  const top = Math.max(1, ...group.members.map((m) => m.minutes));
  const average = group.members.length ? group.totalMinutes / group.members.length : 0;

  return (
    <Panel as="section" className="group" aria-label={group.name}>
      <header className="group-head">
        <div className="group-title-wrap">
          <h2 className="group-title">
            {group.name} <span className="group-title-sub">· this week</span>
          </h2>
          <p className="group-meta">
            {fmtDate(group.weekStart)} – {fmtDate(weekEnd)}
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
        <WeekLines members={group.members} today={group.today} youId={me} />
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
                    <Link to={you ? '/profile' : `/profile/${m.userId}`} className="jam-name">
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
                  <span className="group-segments" aria-hidden>
                    {m.subjects.map((s, j) => (
                      <span
                        key={s.title}
                        className={`group-seg is-${j}`}
                        style={{ width: `${(s.minutes / top) * 100}%` }}
                        title={`${s.title}: ${fmtHours(s.minutes)}`}
                      />
                    ))}
                  </span>
                  {m.subjects.length > 0 && (
                    <span className="sr-only">
                      {m.subjects.map((s) => `${s.title} ${fmtHours(s.minutes)}`).join(', ')}
                    </span>
                  )}
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

/** Study groups: who is live, and each group's week with everyone ranked. */
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
