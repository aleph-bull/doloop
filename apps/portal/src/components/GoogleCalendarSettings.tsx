import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { Button, Chip, Toggle, useToast } from '@komogon/ui';
import { api } from '../lib/api';
import { fmtDate, fmtTime } from '../lib/format';
import { keys, useGoogleStatus, useMe, useUpdateSettings } from '../lib/queries';

/** Google Calendar connect / sync / reconnect (spec §10). Separate consent from sign-in. */
export function GoogleCalendarSettings() {
  const status = useGoogleStatus();
  const me = useMe();
  const update = useUpdateSettings();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const handledResult = useRef<string | null>(null);

  useEffect(() => {
    const g = params.get('google');
    if (!g || handledResult.current === g) return;
    handledResult.current = g;
    const msg: Record<string, string> = {
      connected: 'Google Calendar connected. Courses and deadlines are imported automatically.',
      denied: 'Google access was not granted.',
      invalid: 'The connection link expired. Try again.',
      failed: 'Connecting to Google failed. Try again.',
      unavailable: 'Google Calendar is not configured on this server.',
    };
    toast(msg[g] ?? g);
    params.delete('google');
    setParams(params, { replace: true });
    void qc.invalidateQueries({ queryKey: keys.google });
    void qc.invalidateQueries({ queryKey: keys.nodes });
    void qc.invalidateQueries({ queryKey: keys.pace });
    void qc.invalidateQueries({ queryKey: ['blocks'] });
  }, [params, setParams, toast, qc]);

  const s = status.data;
  const settings = me.data?.user.settings;
  const connect = async () => {
    try {
      const { url } = await api.googleConnect();
      window.location.href = url;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not start');
    }
  };
  const sync = async () => {
    try {
      const r = await api.googleSync();
      toast(
        r.status === 'ok'
          ? `Synced. ${r.academic?.courses ?? 0} new courses, ${r.academic?.tasks ?? 0} new tasks and assessments. Events are up to date.`
          : r.status === 'revoked'
            ? 'Google access was revoked. Reconnect.'
            : 'Not connected',
      );
      void qc.invalidateQueries({ queryKey: keys.google });
      void qc.invalidateQueries({ queryKey: ['blocks'] });
      void qc.invalidateQueries({ queryKey: keys.nodes });
      void qc.invalidateQueries({ queryKey: keys.pace });
      void qc.invalidateQueries({ queryKey: keys.commitments });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Sync failed');
    }
  };

  if (s && !s.available && !s.connected) return null;

  const description = !s
    ? 'Checking…'
    : !s.available
      ? 'Not configured, so this does not work yet.'
      : !s.connected
        ? 'Import courses, assessments and deadlines from your calendars, and sync planned study blocks back to Google.'
        : s.revoked
          ? 'Access was revoked. Reconnect to resume syncing.'
          : `Connected. ${s.lastSyncAt ? `Last sync ${fmtDate(s.lastSyncAt)} ${fmtTime(s.lastSyncAt)}.` : 'Not synced yet.'}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1">
          <div className="font-medium">Google Calendar</div>
          <div className="field-hint">{description}</div>
        </div>
        {s && (
          <Chip tone={s.connected && !s.revoked ? 'ok' : s.connected ? 'warn' : 'neutral'} dot>
            {s.connected && !s.revoked ? 'Connected' : s.connected ? 'Reconnect' : 'Not connected'}
          </Chip>
        )}
      </div>
      <div className="flex gap-2 flex-wrap">
        {s?.available && (!s.connected || s.revoked) && (
          <Button variant="primary" onClick={connect}>
            {s.connected ? 'Reconnect Google' : 'Connect Google Calendar'}
          </Button>
        )}
        {s?.connected && !s.revoked && (
          <>
            <Button onClick={sync}>Sync now</Button>
            <Button
              variant="ghost"
              onClick={() =>
                api.googleDisconnect().then(() => {
                  toast('Disconnected');
                  void qc.invalidateQueries({ queryKey: keys.google });
                })
              }
            >
              Disconnect
            </Button>
          </>
        )}
      </div>
      {settings && (
        <>
          <Toggle
            checked={settings.calendar.syncPlannedBlocks}
            onChange={(v) => update.mutateAsync({ calendar: { syncPlannedBlocks: v } })}
            label="Sync planned blocks to the Study calendar"
          />
          <Toggle
            checked={settings.calendar.readBusyTimes}
            onChange={(v) => update.mutateAsync({ calendar: { readBusyTimes: v } })}
            label="Read busy times from my primary calendar"
            description="Used to suggest free slots."
          />
        </>
      )}
    </div>
  );
}
