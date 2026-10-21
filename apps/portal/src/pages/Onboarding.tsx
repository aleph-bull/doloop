import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Spinner } from '@komogon/ui';
import { ErrorPanel } from '../components/ErrorState';
import { api } from '../lib/api';
import { keys, useMe } from '../lib/queries';

/** Finish account setup quietly; the dashboard is the first screen after sign-in. */
export function Onboarding() {
  const me = useMe();
  const qc = useQueryClient();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!me.data || me.data.onboarded || started.current) return;
    started.current = true;
    void api
      .updateMe({ onboarded: true })
      .then(async () => {
        await qc.invalidateQueries({ queryKey: keys.me });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not finish setting up your account.');
      });
  }, [me.data, qc, attempt]);

  if (me.data?.onboarded) return <Navigate to="/" replace />;
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      {error ? (
        <ErrorPanel
          message={error}
          onRetry={() => {
            started.current = false;
            setError(null);
            setAttempt((n) => n + 1);
          }}
        />
      ) : (
        <Spinner />
      )}
    </div>
  );
}
