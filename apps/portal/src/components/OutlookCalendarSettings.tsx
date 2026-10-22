import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { Button, Chip, useToast } from '@komogon/ui';
import { api } from '../lib/api';
import { fmtDate, fmtTime } from '../lib/format';

export function OutlookCalendarSettings() {
  const status = useQuery({ queryKey: ['calendar', 'outlook'], queryFn: api.outlookStatus });
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useSearchParams();
  const handledResult = useRef<string | null>(null);
  useEffect(() => {
    const result = params.get('outlook');
    if (!result || handledResult.current === result) return;
    handledResult.current = result;
    const messages: Record<string, string> = {
      connected: 'Outlook connected. Courses and deadlines are imported automatically.',
      denied: 'Outlook access was not granted.',
      invalid: 'The connection link expired. Try again.',
      failed: 'Could not finish connecting to Outlook. Try again.',
      unavailable: 'Outlook is not configured on this server.',
    };
    toast(messages[result] ?? 'Could not connect to Outlook.');
    const next = new URLSearchParams(params);
    next.delete('outlook');
    setParams(next, { replace: true });
    void qc.invalidateQueries({ queryKey: ['calendar', 'outlook'] });
    void qc.invalidateQueries({ queryKey: ['nodes'] });
    void qc.invalidateQueries({ queryKey: ['blocks'] });
    void qc.invalidateQueries({ queryKey: ['pace'] });
  }, [params, setParams, qc, toast]);
  const action = async (kind: 'connect' | 'sync' | 'disconnect') => {
    setBusy(true);
    try {
      if (kind === 'connect') {
        window.location.href = (await api.outlookConnect()).url;
        return;
      }
      if (kind === 'disconnect') {
        await api.outlookDisconnect();
        toast('Outlook disconnected. Imported courses and tasks are kept.');
      } else {
        const result = await api.outlookSync();
        toast(
          result.status === 'ok'
            ? `Synced. ${result.courses} new courses, ${result.tasks} new tasks and assessments.`
            : result.status === 'revoked'
              ? 'Outlook access expired. Reconnect to continue.'
              : 'Connect Outlook first.',
        );
      }
      for (const key of [
        ['calendar', 'outlook'],
        ['nodes'],
        ['blocks'],
        ['pace'],
        ['calendar', 'commitments'],
      ])
        void qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not sync Outlook.');
    } finally {
      setBusy(false);
    }
  };
  const s = status.data;
  if (s && !s.available && !s.connected) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1">
          <div className="font-medium">Outlook Calendar</div>
          <p className="field-hint">
            {status.isError
              ? 'Could not check the connection.'
              : !s
                ? 'Checking…'
                : !s.available
                  ? 'Not configured on this server yet.'
                  : !s.connected
                    ? 'Import calendars from a Microsoft personal, work or school account.'
                    : s.revoked
                      ? 'Access expired. Reconnect to resume imports.'
                      : `Connected.${s.lastSyncAt ? ` Last sync ${fmtDate(s.lastSyncAt)} ${fmtTime(s.lastSyncAt)}.` : ''}`}
          </p>
        </div>
        {s && (
          <Chip tone={s.connected && !s.revoked ? 'ok' : s.revoked ? 'warn' : 'neutral'} dot>
            {s.connected && !s.revoked ? 'Connected' : s.revoked ? 'Reconnect' : 'Not connected'}
          </Chip>
        )}
      </div>
      <div className="flex gap-2 flex-wrap">
        {status.isError && <Button onClick={() => void status.refetch()}>Try again</Button>}
        {s?.available && (!s.connected || s.revoked) && (
          <Button variant="primary" loading={busy} onClick={() => void action('connect')}>
            {s.connected ? 'Reconnect Outlook' : 'Connect Outlook Calendar'}
          </Button>
        )}
        {s?.connected && !s.revoked && (
          <Button loading={busy} onClick={() => void action('sync')}>
            Sync now
          </Button>
        )}
        {s?.connected && (
          <Button variant="ghost" disabled={busy} onClick={() => void action('disconnect')}>
            Disconnect
          </Button>
        )}
      </div>
      <p className="field-hint">
        Outlook imports are read-only. Your original events stay in Outlook.
      </p>
      <p className="field-hint">
        <Link to="/tasks">View tasks</Link> · <Link to="/calendar">View calendar</Link>
      </p>
    </div>
  );
}
