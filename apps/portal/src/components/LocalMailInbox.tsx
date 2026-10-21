import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

/** Visible only for the explicit loopback mail sandbox. Hosted codes never enter this UI. */
export function LocalMailInbox({ email }: { email: string }) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  const status = useQuery({ queryKey: ['email-status'], queryFn: api.emailStatus, enabled: local });
  const inbox = useQuery({
    queryKey: ['local-outbox', email],
    queryFn: () => api.localOutbox(email),
    enabled: local && status.data?.mode === 'local' && email.includes('@'),
    refetchInterval: 2000,
    retry: false,
  });
  if (!local || status.data?.mode !== 'local') return null;
  return (
    <details className="local-test-accounts" open>
      <summary>Local test email</summary>
      <p className="field-hint">No email leaves this sandbox.</p>
      {inbox.data?.messages.slice(0, 1).map((message) => (
        <div key={message.id} className="local-mail-message">
          <strong>{message.subject}</strong>
          <pre>{message.text}</pre>
        </div>
      ))}
    </details>
  );
}
