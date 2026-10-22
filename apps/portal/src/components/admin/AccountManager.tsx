import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { toLocalDate } from '@komogon/core';
import { Button, Chip, Input, Modal, Spinner, Toggle, useToast } from '@komogon/ui';
import { adminKeys, adminSend, type AdminAccount, type AdminSession } from '../../lib/admin';
import { fmtDate, fmtMinutes } from '../../lib/format';

const PAGE = 15;

/**
 * One account up close: add or take away study time, send it through onboarding again,
 * and suspend or delete it. Admins (yourself included) can't be suspended or deleted.
 */
export function AccountManager({
  account,
  onClose,
}: {
  account: AdminAccount | null;
  onClose: () => void;
}) {
  // Keep the last account while the dialog fades out.
  const [shown, setShown] = useState(account);
  useEffect(() => {
    if (account) setShown(account);
  }, [account]);
  return (
    <Modal
      phone="full"
      open={!!account}
      onClose={onClose}
      title={shown?.email}
      className="admin-manage"
      actions={<Button onClick={onClose}>Done</Button>}
    >
      {shown ? <ManageBody key={shown.id} account={shown} onDeleted={onClose} /> : null}
    </Modal>
  );
}

function ManageBody({ account, onDeleted }: { account: AdminAccount; onDeleted: () => void }) {
  return (
    <div className="admin-manage-body">
      <p className="admin-manage-meta muted text-sm">
        {account.you && <Chip tone="neutral">You</Chip>}
        {account.admin && !account.you && <Chip tone="neutral">Admin</Chip>}
        {account.bannedAt && <Chip tone="warn">Suspended</Chip>}
        <span>
          Joined {fmtDate(account.createdAt, { year: 'numeric' })} ·{' '}
          {fmtMinutes(account.focusMinutes)} studied · {account.sessions}{' '}
          {account.sessions === 1 ? 'session' : 'sessions'} · {account.timezone.replace(/_/g, ' ')}
        </span>
      </p>
      <StudyTime account={account} />
      <Onboarding account={account} />
      <AccountStatus account={account} onDeleted={onDeleted} />
    </div>
  );
}

/** Lists, accounts and the dashboard figures all move together after a change. */
function useRefresh(account: AdminAccount) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: adminKeys.accounts }),
      qc.invalidateQueries({ queryKey: adminKeys.sessions(account.id) }),
      qc.invalidateQueries({ queryKey: adminKeys.blocked }),
      // Your own account: the dashboard and analytics read the same sessions.
      ...(account.you ? [qc.invalidateQueries()] : []),
    ]);
}

/* ---------- study time ---------- */

function StudyTime({ account }: { account: AdminAccount }) {
  const { toast } = useToast();
  const refresh = useRefresh(account);
  const today = toLocalDate(new Date(), account.timezone);
  const [date, setDate] = useState(today);
  const [hours, setHours] = useState('1');
  const [minutes, setMinutes] = useState('0');
  const [adding, setAdding] = useState(false);

  const sessions = useInfiniteQuery({
    queryKey: adminKeys.sessions(account.id),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const q = new URLSearchParams({ limit: String(PAGE) });
      if (pageParam) q.set('before', pageParam);
      return (
        await adminSend<{ sessions: AdminSession[] }>(
          'GET',
          `/api/admin/accounts/${account.id}/sessions?${q}`,
        )
      ).sessions;
    },
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1]!.startedAt : null),
  });

  const total = (Number(hours) || 0) * 60 + (Number(minutes) || 0);
  const add = async () => {
    setAdding(true);
    try {
      await adminSend('POST', `/api/admin/accounts/${account.id}/time`, { date, minutes: total });
      toast(`Added ${fmtMinutes(total)} on ${fmtDate(`${date}T12:00:00Z`, { timeZone: 'UTC' })}.`);
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add the time');
    } finally {
      setAdding(false);
    }
  };

  const rows = sessions.data?.pages.flat() ?? [];
  return (
    <section className="admin-section">
      <h3 className="font-medium">Study time</h3>
      <form
        className="admin-time-form"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Input
          label="Day"
          type="date"
          required
          max={today}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Input
          label="Hours"
          type="number"
          min={0}
          max={24}
          value={hours}
          onChange={(e) => setHours(e.target.value)}
        />
        <Input
          label="Minutes"
          type="number"
          min={0}
          max={59}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          loading={adding}
          disabled={total < 1 || total > 1440}
        >
          Add time
        </Button>
      </form>
      <p className="field-hint">
        Added as a finished session on that day in their time zone (at noon, or ending now if it's
        today). It counts wherever studied time does, but earns no XP.
      </p>

      {sessions.isPending ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="muted text-sm">No sessions yet.</p>
      ) : (
        <ul className="admin-sessions">
          {rows.map((s) => (
            <SessionRow key={s.id} account={account} session={s} />
          ))}
        </ul>
      )}
      {sessions.hasNextPage && (
        <div>
          <Button
            size="sm"
            variant="ghost"
            loading={sessions.isFetchingNextPage}
            onClick={() => void sessions.fetchNextPage()}
          >
            Show older
          </Button>
        </div>
      )}
    </section>
  );
}

function SessionRow({ account, session }: { account: AdminAccount; session: AdminSession }) {
  const { toast } = useToast();
  const refresh = useRefresh(account);
  const [mode, setMode] = useState<'idle' | 'trim' | 'delete'>('idle');
  const [take, setTake] = useState('');
  const [busy, setBusy] = useState(false);
  const focus = Math.round(session.workSeconds / 60);
  const when = new Intl.DateTimeFormat(undefined, {
    timeZone: account.timezone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(session.startedAt));

  const run = async (call: () => Promise<unknown>, done: string, failed: string) => {
    setBusy(true);
    try {
      await call();
      toast(done);
      setMode('idle');
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : failed);
    } finally {
      setBusy(false);
    }
  };
  const trim = () =>
    run(
      () =>
        adminSend('POST', `/api/admin/accounts/${account.id}/sessions/${session.id}/trim`, {
          removeFocusMinutes: Number(take),
        }),
      `Took ${fmtMinutes(Number(take))} off.`,
      'Could not take the time off',
    );
  const remove = () =>
    run(
      () => adminSend('DELETE', `/api/admin/accounts/${account.id}/sessions/${session.id}`),
      'Session deleted.',
      'Could not delete the session',
    );

  return (
    <li className="admin-session">
      <span className="admin-session-when tabular">{when}</span>
      <span className="admin-session-title">{session.title}</span>
      <span className="admin-session-focus tabular">{fmtMinutes(focus)}</span>
      <span className="admin-session-actions">
        {mode === 'idle' && (
          <>
            {focus > 1 && (
              <button type="button" className="link-button" onClick={() => setMode('trim')}>
                Take time off
              </button>
            )}
            <button type="button" className="link-button" onClick={() => setMode('delete')}>
              Delete
            </button>
          </>
        )}
        {mode === 'trim' && (
          <form
            className="admin-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void trim();
            }}
          >
            <Input
              type="number"
              min={1}
              max={focus - 1}
              required
              autoFocus
              placeholder="Minutes"
              aria-label="Minutes to take off"
              value={take}
              onChange={(e) => setTake(e.target.value)}
            />
            <Button type="submit" size="sm" loading={busy}>
              Take off
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>
              Cancel
            </Button>
          </form>
        )}
        {mode === 'delete' && (
          <>
            <Button size="sm" variant="danger" loading={busy} onClick={() => void remove()}>
              Delete session
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>
              Keep
            </Button>
          </>
        )}
      </span>
    </li>
  );
}

/* ---------- onboarding ---------- */

function Onboarding({ account }: { account: AdminAccount }) {
  const { toast } = useToast();
  const refresh = useRefresh(account);
  const [busy, setBusy] = useState(false);
  const restart = async () => {
    setBusy(true);
    try {
      await adminSend('POST', `/api/admin/accounts/${account.id}/onboarding`);
      toast(
        account.you
          ? 'Onboarding starts again next time the page loads.'
          : `${account.email} goes through onboarding next time they open Komodon.`,
      );
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not restart onboarding');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="admin-section">
      <h3 className="font-medium">Onboarding</h3>
      <div className="admin-tool">
        <p className="field-hint">
          {account.onboarded
            ? 'Starts it again next time they open Komodon. Their tasks, sessions, streaks and settings stay; the hints they closed come back.'
            : "They haven't finished onboarding yet."}
        </p>
        {account.onboarded && (
          <Button size="sm" onClick={() => void restart()} loading={busy}>
            Start onboarding again
          </Button>
        )}
      </div>
    </section>
  );
}

/* ---------- suspending and deleting ---------- */

function AccountStatus({ account, onDeleted }: { account: AdminAccount; onDeleted: () => void }) {
  const { toast } = useToast();
  const refresh = useRefresh(account);
  const [busy, setBusy] = useState<'suspend' | 'delete' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState('');
  const [block, setBlock] = useState(true);

  if (account.admin)
    return (
      <section className="admin-section">
        <h3 className="font-medium">Account</h3>
        <p className="field-hint">Admin accounts can't be suspended or deleted from here.</p>
      </section>
    );

  const toggleSuspension = async () => {
    setBusy('suspend');
    try {
      await adminSend(
        account.bannedAt ? 'DELETE' : 'POST',
        `/api/admin/accounts/${account.id}/suspend`,
      );
      toast(
        account.bannedAt ? `${account.email} can sign in again.` : `${account.email} is suspended.`,
      );
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not change the suspension');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    try {
      await adminSend('DELETE', `/api/admin/accounts/${account.id}?block=${block}`);
      toast(`${account.email} is deleted.`);
      onDeleted();
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete the account');
      setBusy(null);
    }
  };

  return (
    <section className="admin-section">
      <h3 className="font-medium">Account</h3>
      <div className="admin-tool">
        <p className="field-hint">
          {account.bannedAt
            ? `Suspended since ${fmtDate(account.bannedAt)}. Their data is kept; they can't sign in until you lift it.`
            : 'Suspending signs them out, keeps their email from signing in, and takes them off the feed and leaderboard. Their data is kept.'}
        </p>
        <Button size="sm" onClick={() => void toggleSuspension()} loading={busy === 'suspend'}>
          {account.bannedAt ? 'Lift suspension' : 'Suspend'}
        </Button>
      </div>
      {!deleting ? (
        <div className="admin-tool">
          <p className="field-hint">Deletes the account and everything in it, for good.</p>
          <Button size="sm" variant="danger" onClick={() => setDeleting(true)}>
            Delete account
          </Button>
        </div>
      ) : (
        <div className="admin-delete">
          <Input
            label="Type their email to confirm"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          <Toggle
            checked={block}
            onChange={setBlock}
            label="Keep this email blocked"
            description="So it can't sign up again."
          />
          <div className="flex gap-2">
            <Button
              variant="danger"
              disabled={typed.trim().toLowerCase() !== account.email.toLowerCase()}
              loading={busy === 'delete'}
              onClick={() => void remove()}
            >
              Delete for good
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDeleting(false);
                setTyped('');
              }}
            >
              Keep the account
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
