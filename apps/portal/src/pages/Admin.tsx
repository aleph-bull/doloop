import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Input, Panel, Spinner, useToast } from '@komogon/ui';
import { adminFetch } from '../lib/admin';

interface AdminAccount {
  id: string;
  email: string;
  createdAt: string;
  onboarded: boolean;
  hasPassword: boolean;
  xp: number;
  level: number;
  streak: number;
  sessions: number;
}

/** Every account in this alpha, for whoever runs it. */
export function Admin() {
  const { toast } = useToast();
  const accounts = useQuery({
    queryKey: ['admin', 'accounts'],
    queryFn: async () =>
      ((await (await adminFetch('/api/admin/accounts')).json()) as { accounts: AdminAccount[] })
        .accounts,
    retry: false,
  });
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const download = async (a: AdminAccount) => {
    try {
      const res = await adminFetch(`/api/admin/accounts/${a.id}/export`);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `komogon-${a.email}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Download failed');
    }
  };

  const setPassword = async (a: AdminAccount) => {
    try {
      await adminFetch(`/api/admin/accounts/${a.id}/password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      });
      toast(`New password set for ${a.email}.`);
      setResetFor(null);
      setNewPassword('');
      void accounts.refetch();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not set the password');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="page-title">Admin</h1>
      {accounts.isPending ? (
        <Spinner />
      ) : accounts.isError ? (
        <Panel className="p-5">
          <p>This page is only for the people running Komogon.</p>
        </Panel>
      ) : (
        <Panel className="p-5 flex flex-col gap-3">
          <p className="muted text-sm">
            {accounts.data.length} {accounts.data.length === 1 ? 'account' : 'accounts'}. Download
            gives everything an account has saved, as JSON.
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Joined</th>
                  <th>Sessions</th>
                  <th>Level</th>
                  <th>Streak</th>
                  <th>Password</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {accounts.data.map((a) => (
                  <tr key={a.id}>
                    <td>{a.email}</td>
                    <td className="tabular">{a.createdAt.slice(0, 10)}</td>
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
                      <Button size="sm" onClick={() => void download(a)}>
                        Download
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
