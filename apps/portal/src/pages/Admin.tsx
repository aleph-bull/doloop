import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Button, Chip, Input, Panel, Spinner, useToast } from '@komogon/ui';
import { AccountManager } from '../components/admin/AccountManager';
import {
  adminFetch,
  adminKeys,
  adminSend,
  type AdminAccount,
  type BlockedEmail,
} from '../lib/admin';
import { fmtDate, fmtMinutes } from '../lib/format';
import { keys, useMe } from '../lib/queries';
import '../components/admin/admin.css';

/** Every account in this alpha, for whoever runs it, and the tools to look after them. */
export function Admin() {
  const { toast } = useToast();
  const accounts = useQuery({
    queryKey: adminKeys.accounts,
    queryFn: async () =>
      ((await (await adminFetch('/api/admin/accounts')).json()) as { accounts: AdminAccount[] })
        .accounts,
    retry: false,
  });
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [managing, setManaging] = useState<string | null>(null);

  const download = async (a: AdminAccount) => {
    try {
      const res = await adminFetch(`/api/admin/accounts/${a.id}/export`);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `komodon-${a.email}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Download failed');
    }
  };

  const setPassword = async (a: AdminAccount) => {
    try {
      await adminSend('POST', `/api/admin/accounts/${a.id}/password`, { password: newPassword });
      toast(`New password set for ${a.email}.`);
      setResetFor(null);
      setNewPassword('');
      void accounts.refetch();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not set the password');
    }
  };

  const managed = accounts.data?.find((a) => a.id === managing) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="page-title">Admin</h1>
      {accounts.isPending ? (
        <Spinner />
      ) : accounts.isError ? (
        <Panel className="p-5">
          <p>This page is only for the people running Komodon.</p>
        </Panel>
      ) : (
        <>
          <Panel className="p-5 flex flex-col gap-3">
            <p className="muted text-sm">
              {accounts.data.length} {accounts.data.length === 1 ? 'account' : 'accounts'}. Download
              gives everything an account has saved, as JSON. Manage adds or takes away study time,
              restarts onboarding, and suspends or deletes the account.
            </p>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Joined</th>
                    <th>Focus</th>
                    <th>Sessions</th>
                    <th>Level</th>
                    <th>Streak</th>
                    <th>Password</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {accounts.data.map((a) => (
                    <tr key={a.id} className={a.bannedAt ? 'admin-row-suspended' : undefined}>
                      <td>
                        <span className="admin-email">
                          {a.email}
                          {a.you && <Chip tone="neutral">You</Chip>}
                          {a.admin && !a.you && <Chip tone="neutral">Admin</Chip>}
                          {a.bannedAt && <Chip tone="warn">Suspended</Chip>}
                          {!a.onboarded && <Chip tone="info">Onboarding</Chip>}
                        </span>
                      </td>
                      <td className="tabular">{a.createdAt.slice(0, 10)}</td>
                      <td className="tabular">{fmtMinutes(a.focusMinutes)}</td>
                      <td className="tabular">{a.sessions}</td>
                      <td className="tabular">{a.level}</td>
                      <td className="tabular">{a.streak}</td>
                      <td>
                        {resetFor === a.id ? (
                          <form
                            className="flex gap-2 items-end"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void setPassword(a);
                            }}
                          >
                            <Input
                              label="New password"
                              type="text"
                              autoComplete="off"
                              minLength={6}
                              required
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                            />
                            <Button type="submit" size="sm" variant="primary">
                              Set
                            </Button>
                          </form>
                        ) : (
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => {
                              setResetFor(a.id);
                              setNewPassword('');
                            }}
                          >
                            {a.hasPassword ? 'Set a new one' : 'Give it one'}
                          </button>
                        )}
                      </td>
                      <td>
                        <div className="flex gap-2 justify-end">
                          <Button size="sm" onClick={() => setManaging(a.id)}>
                            Manage
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void download(a)}>
                            Download
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="admin-grid">
            <DevTools />
            <BlockedEmails />
          </div>
        </>
      )}
      <AccountManager account={managed} onClose={() => setManaging(null)} />
    </div>
  );
}

/** Tools for trying the app out on your own account. */
function DevTools() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const onboardAgain = async () => {
    const id = me.data?.user.id;
    if (!id) return;
    setBusy(true);
    try {
      await adminSend('POST', `/api/admin/accounts/${id}/onboarding`);
      // The hints closed on this device are mirrored here too; clear them with the server's.
      try {
        localStorage.removeItem('komogon.hints.dismissed');
      } catch {
        /* storage blocked: the server copy is the one that matters */
      }
      await qc.invalidateQueries({ queryKey: keys.me });
      navigate('/onboarding');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not restart onboarding');
      setBusy(false);
    }
  };

  return (
    <Panel className="p-5 flex flex-col gap-4">
      <h2 className="section-title">Dev tools</h2>
      <div className="admin-tool">
        <div className="flex flex-col gap-1">
          <p className="font-medium">Go through onboarding again</p>
          <p className="field-hint">
            On your own account. Your tasks, sessions, streaks and settings stay as they are; the
            hints you closed come back.
          </p>
        </div>
        <Button onClick={() => void onboardAgain()} loading={busy}>
          Start onboarding
        </Button>
      </div>
    </Panel>
  );
}

/** Addresses that can't sign up or sign in. */
function BlockedEmails() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const blocked = useQuery({
    queryKey: adminKeys.blocked,
    queryFn: async () =>
      (await adminSend<{ blocked: BlockedEmail[] }>('GET', '/api/admin/blocked-emails')).blocked,
  });

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: adminKeys.blocked }),
      qc.invalidateQueries({ queryKey: adminKeys.accounts }),
    ]);

  const block = async () => {
    setBusy(true);
    try {
      await adminSend('POST', '/api/admin/blocked-emails', { email });
      toast(`${email.trim()} is blocked.`);
      setEmail('');
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not block that address');
    } finally {
      setBusy(false);
    }
  };

  const unblock = async (b: BlockedEmail) => {
    try {
      await adminSend('DELETE', `/api/admin/blocked-emails/${encodeURIComponent(b.email)}`);
      toast(`${b.email} can sign in again.`);
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not unblock that address');
    }
  };

  return (
    <Panel className="p-5 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="section-title">Blocked emails</h2>
        <p className="field-hint">
          A blocked address can't sign up or sign in. If it already has an account, that account is
          suspended too.
        </p>
      </div>
      <form
        className="admin-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void block();
        }}
      >
        <Input
          type="email"
          required
          placeholder="name@example.com"
          aria-label="Email to block"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button type="submit" loading={busy}>
          Block
        </Button>
      </form>
      {blocked.data && blocked.data.length > 0 ? (
        <ul className="admin-list">
          {blocked.data.map((b) => (
            <li key={b.email}>
              <span className="admin-list-main">{b.email}</span>
              <span className="muted text-sm">
                {b.accountId ? 'Has an account' : 'No account'} · {fmtDate(b.createdAt)}
              </span>
              <button type="button" className="link-button" onClick={() => void unblock(b)}>
                Unblock
              </button>
            </li>
          ))}
        </ul>
      ) : (
        blocked.data && <p className="muted text-sm">Nobody is blocked.</p>
      )}
    </Panel>
  );
}
