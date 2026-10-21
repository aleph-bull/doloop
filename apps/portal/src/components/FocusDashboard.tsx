import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Glass, Input, Spinner, Toggle } from '@komogon/ui';
import type { EndSummary } from '../lib/api';
import { useActiveSession, useMe, useStartSession, useUpdateSettings } from '../lib/queries';
import { NudgesCard } from './NudgesCard';
import { TimerCard } from './TimerCard';
import { RewardOverlay } from './RewardOverlay';

/** A session can begin here without a task, a tour or a setup dialog. */
export function FocusDashboard() {
  const me = useMe();
  const active = useActiveSession();
  const start = useStartSession();
  const update = useUpdateSettings();
  const navigate = useNavigate();
  const settings = me.data!.user.settings;
  const [pomodoro, setPomodoro] = useState(false);
  const [workMin, setWorkMin] = useState(String(settings.pomodoro.workMin));
  const [breakMin, setBreakMin] = useState(String(settings.pomodoro.shortBreakMin));
  const [timelapse, setTimelapse] = useState(settings.timelapse.record === 'always');
  const [showTimer, setShowTimer] = useState(settings.pomodoro.showTimerByDefault);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<EndSummary | null>(null);

  const begin = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await update.mutateAsync({
        ...(pomodoro
          ? { pomodoro: { workMin: Number(workMin), shortBreakMin: Number(breakMin) } }
          : {}),
        timelapse: { record: timelapse ? 'always' : 'never' },
      });
      // The focus screen must see this choice before it decides whether to record.
      await me.refetch();
      await start.mutateAsync({ mode: pomodoro ? 'pomodoro' : 'unlimited', showTimer });
      // Recording lives on the focus screen. Use this tab, with no extra question.
      if (timelapse) navigate('/focus');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const showMore = async () => {
    setError(null);
    try {
      await update.mutateAsync({ dashboard: { focusOnly: false } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not show the other features.');
    }
  };

  return (
    <div className="focus-dashboard">
      <div className="page-head">
        <div>
          <h1 className="page-title">Time to focus</h1>
          <p className="greeting-line">A little space for what you want to do.</p>
        </div>
      </div>
      <NudgesCard />
      {active.isPending ? (
        <Spinner />
      ) : active.isError ? (
        <div role="alert">
          <p>Could not check for a running session.</p>
          <Button onClick={() => void active.refetch()}>Try again</Button>
        </div>
      ) : active.data?.active ? (
        <TimerCard
          active={active.data.active}
          settings={settings}
          nodes={[]}
          onEnded={setSummary}
        />
      ) : (
        <Glass className="focus-start p-6" strong>
          <form onSubmit={(event) => void begin(event)} className="flex flex-col gap-6">
            <h2 className="section-title">Your session</h2>
            <Toggle
              checked={pomodoro}
              onChange={setPomodoro}
              label="Pomodoro"
              description="Alternate focus time with breaks."
              disabled={busy}
            />
            {pomodoro && (
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Focus minutes"
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={workMin}
                  onChange={(e) => setWorkMin(e.target.value)}
                  disabled={busy}
                />
                <Input
                  label="Break minutes"
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={breakMin}
                  onChange={(e) => setBreakMin(e.target.value)}
                  disabled={busy}
                />
              </div>
            )}
            <Toggle
              checked={timelapse}
              onChange={setTimelapse}
              label="Timelapse"
              description="Record with your camera on the focus screen. The video stays on this device."
              disabled={busy}
            />
            <Toggle
              checked={showTimer}
              onChange={setShowTimer}
              label="Show the timer"
              disabled={busy}
            />
            <Button type="submit" variant="primary" size="lg" loading={busy}>
              Start
            </Button>
          </form>
        </Glass>
      )}
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      <Button variant="ghost" onClick={() => void showMore()} disabled={busy || update.isPending}>
        Show full dashboard
      </Button>
      <RewardOverlay
        summary={summary}
        onClose={() => setSummary(null)}
        phrasesEnabled={settings.effects.phrases}
        badgeToasts={settings.effects.badgeToasts}
      />
    </div>
  );
}
