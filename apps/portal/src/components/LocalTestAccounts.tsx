import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Button, useToast } from '@komogon/ui';
import { apiBaseUrl } from '../lib/api';
import { useAuth } from '../lib/auth';

interface TestAccount {
  role: 'onboarding' | 'admin';
  email: string;
  password: string;
}

export function LocalTestAccounts() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  const accounts = useQuery({
    queryKey: ['local-test-accounts'],
    enabled: local && auth.mode === 'server',
    retry: false,
    queryFn: async () => {
      const response = await fetch(`${apiBaseUrl(true)}/api/auth/local-test-accounts`);
      if (!response.ok) return null;
      return response.json() as Promise<{ accounts: TestAccount[] }>;
    },
  });
  if (!local || !accounts.data) return null;
  const signIn = async (account: TestAccount, reset = false) => {
    setBusy(true);
    try {
      if (reset) {
        const response = await fetch(
          `${apiBaseUrl(true)}/api/auth/local-test-accounts/onboarding/reset`,
          { method: 'POST' },
        );
        if (!response.ok) throw new Error('Could not reset the onboarding account.');
      }
      await auth.signInWithPassword(account.email, account.password);
      navigate(account.role === 'admin' ? '/admin' : '/', { replace: true });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="local-test-accounts">
      <summary>Local test accounts</summary>
      <p className="field-hint">
        These accounts stay in this sandbox and are excluded from the leaderboard.
      </p>
      {accounts.data.accounts.map((account) => (
        <div key={account.role} className="local-test-account">
          <strong>{account.role === 'admin' ? 'Admin' : 'Onboarding'}</strong>
          <span>{account.email}</span>
          <code>{account.password}</code>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" disabled={busy} onClick={() => void signIn(account)}>
              {account.role === 'admin' ? 'Open admin' : 'Sign in to onboarding'}
            </Button>
            {account.role === 'onboarding' && (
              <Button size="sm" disabled={busy} onClick={() => void signIn(account, true)}>
                Reset and start onboarding
              </Button>
            )}
          </div>
        </div>
      ))}
    </details>
  );
}
