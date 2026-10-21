import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ChevronDown, Crown, Hash, Plus } from 'lucide-react';
import { Button, Panel, Segmented, Spinner, useToast } from '@komogon/ui';
import type { Jam, Person } from '../../lib/api';
import { fmtDate, fmtHours } from '../../lib/format';
import {
  useCreateJam,
  useEndJam,
  useJams,
  useJoinJam,
  useJoinJamByCode,
  useLeaveJam,
  useMe,
} from '../../lib/queries';
import { ErrorPanel } from '../ErrorState';
import { Avatar } from './Avatar';
import { DayLines, hm } from './DayLines';
import { Subjects } from './GroupsTab';

const unknown = (id: string): Person => ({
  id,
  name: 'Someone',
  avatarUrl: null,
  university: null,
});

/** "ends in 3 h", "ends in 2 d", "ended Oct 20". */
function endsIn(jam: Jam, now = Date.now()): string {
  if (jam.ended) return `Ended ${fmtDate(jam.endsAt)}`;
  const h = Math.max(0, (Date.parse(jam.endsAt) - now) / 3_600_000);
  if (h < 1) return 'Ends within the hour';
  if (h < 24) return `Ends in ${Math.round(h)} h`;
  return `Ends in ${Math.round(h / 24)} d`;
}

function Starter() {
  const create = useCreateJam();
  const joinByCode = useJoinJamByCode();
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [days, setDays] = useState<'1' | '3' | '7'>('1');
  const [code, setCode] = useState('');
  const fail = (err: unknown) => toast(err instanceof Error ? err.message : 'Could not do that');

  const start = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { title: title.trim() || undefined, days: Number(days) },
      { onSuccess: () => setTitle(''), onError: fail },
    );
  };
  const join = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c.length !== 6) return;
    joinByCode.mutate(c, { onSuccess: () => setCode(''), onError: fail });
  };

  return (
    <div className="jam-starter">
      <Panel as="form" className="jam-form" onSubmit={start} aria-label="Start a jam">
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 60))}
          placeholder="Study jam"
          aria-label="Name"
        />
        <Segmented
          ariaLabel="How long"
          value={days}
          onChange={setDays}
          options={[
            { value: '1', label: 'Today' },
            { value: '3', label: '3 days' },
            { value: '7', label: 'A week' },
          ]}
        />
        <Button type="submit" variant="primary" size="sm" loading={create.isPending}>
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
          aria-label="Jam code"
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

/**
 * One jam: who is in it, ranked by minutes since they joined, the leader with a crown.
 * Opened, it shows the lines through the jam's days and what each person worked on.
 */
function JamCard({ jam, people }: { jam: Jam; people: Record<string, Person> }) {
  const me = useMe().data?.user.id;
  const join = useJoinJam();
  const leave = useLeaveJam();
  const end = useEndJam();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const fail = (err: unknown) => toast(err instanceof Error ? err.message : 'Could not do that');
  const top = Math.max(1, ...jam.members.map((m) => m.minutes));
  const leader = jam.members[0];
  const host = people[jam.hostId] ?? unknown(jam.hostId);
  const someMinutes = jam.members.some((m) => m.minutes > 0);

  return (
    <Panel as="section" className={`jam${jam.ended ? ' is-ended' : ''}`} aria-label={jam.title}>
      <header className="jam-head">
        <button
          type="button"
          className="jam-open"
          aria-expanded={open}
          aria-label={open ? 'Hide details' : 'Show details'}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown size={16} aria-hidden className={open ? 'is-open' : undefined} />
        </button>
        <div className="jam-title-wrap">
          <h2 className="jam-title">{jam.title}</h2>
          <p className="jam-meta">
            {endsIn(jam)} · {jam.hostId === me ? 'yours' : `${host.name}'s`}
            {jam.code && (
              <>
                {' '}
                · code <span className="jam-code-chip tabular">{jam.code}</span>
              </>
            )}
          </p>
        </div>
        {jam.ended ? (
          leader &&
          someMinutes && (
            <span className="jam-winner">
              <Crown size={14} aria-hidden />
              {leader.userId === me
                ? 'You won'
                : `${(people[leader.userId] ?? unknown(leader.userId)).name} won`}
            </span>
          )
        ) : jam.you ? (
          jam.hostId === me ? (
            <Button
              size="sm"
              variant="ghost"
              loading={end.isPending}
              onClick={() => end.mutate(jam.id, { onError: fail })}
            >
              End now
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              loading={leave.isPending}
              onClick={() => leave.mutate(jam.id, { onError: fail })}
            >
              Leave
            </Button>
          )
        ) : (
          <Button
            size="sm"
            variant="primary"
            loading={join.isPending}
            onClick={() => join.mutate(jam.id, { onError: fail })}
          >
            Join
          </Button>
        )}
      </header>
      <ol className="jam-rows">
        {jam.members.map((m, i) => {
          const p = people[m.userId] ?? unknown(m.userId);
          const you = m.userId === me;
          const leading = i === 0 && m.minutes > 0;
          return (
            <li key={m.userId} className={`jam-row${you ? ' is-you' : ''}`}>
              <span className="jam-rank tabular">{i + 1}</span>
              <Link to={you ? '/profile' : `/profile/${m.userId}`} className="jam-who">
                <Avatar name={p.name} url={p.avatarUrl} size="xs" />
                <span className="jam-name">{you ? 'You' : p.name}</span>
                {leading && <Crown size={13} aria-hidden className="jam-crown" />}
              </Link>
              <span className="cmp-bar-track" aria-hidden>
                <span className="cmp-bar-fill" style={{ width: `${(m.minutes / top) * 100}%` }} />
              </span>
              <span className="jam-minutes tabular">
                {m.minutes > 0 ? fmtHours(m.minutes) : '–'}
              </span>
            </li>
          );
        })}
      </ol>
      {open && (
        <div className="jam-details">
          <DayLines
            days={jam.days ?? []}
            series={jam.members.map((m) => ({ id: m.userId, values: m.byDay ?? [] }))}
            youId={me ?? ''}
            label="Running totals through the jam, one line per person"
          />
          <ul className="jam-people">
            {jam.members.map((m) => {
              const p = people[m.userId] ?? unknown(m.userId);
              const you = m.userId === me;
              return (
                <li key={m.userId} className="jam-person">
                  <span className="group-name-line">
                    <Avatar name={p.name} url={p.avatarUrl} size="xs" />
                    <span className="jam-name">{you ? 'You' : p.name}</span>
                    <span className="jam-person-meta">
                      {m.sessions} {m.sessions === 1 ? 'session' : 'sessions'} · {hm(m.minutes)}
                      {' · joined '}
                      {fmtDate(m.joinedAt)}
                    </span>
                  </span>
                  <Subjects subjects={m.subjects ?? []} top={top} />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/** Jams: start one, join a friend's or one by code, and see where everyone stands. */
export function JamsTab() {
  const q = useJams();
  if (q.isError)
    return <ErrorPanel message="Could not load the jams." onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <div className="flex justify-center p-8">
        <Spinner />
      </div>
    );
  const { active, open, ended, people } = q.data;
  return (
    <div className="jams">
      <Starter />
      {active.length === 0 && open.length === 0 && (
        <p className="muted text-sm jam-empty">
          A jam is a small game. Start one, friends join, and whoever puts in the most focused time
          before it ends takes it.
        </p>
      )}
      {active.map((j) => (
        <JamCard key={j.id} jam={j} people={people} />
      ))}
      {open.length > 0 && (
        <>
          <h2 className="jam-section">Friends are in</h2>
          {open.map((j) => (
            <JamCard key={j.id} jam={j} people={people} />
          ))}
        </>
      )}
      {ended.length > 0 && (
        <>
          <h2 className="jam-section">Finished</h2>
          {ended.map((j) => (
            <JamCard key={j.id} jam={j} people={people} />
          ))}
        </>
      )}
    </div>
  );
}
