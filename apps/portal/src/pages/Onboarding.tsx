import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Backdrop, Button, Glass, Input, useToast } from '@komogon/ui';
import { api } from '../lib/api';
import { localToIso } from '../lib/format';
import { keys, useMe } from '../lib/queries';

function defaultDue(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Four steps to a running timer (spec §13): who you are, then what you are studying. */
export function Onboarding() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const me = useMe();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [course, setCourse] = useState('');
  const [task, setTask] = useState('');
  const [due, setDue] = useState(defaultDue);
  const [hours, setHours] = useState('3');
  const [busy, setBusy] = useState(false);

  const finish = async (startNow: boolean) => {
    setBusy(true);
    try {
      const trimmedName = name.trim();
      if (trimmedName) await api.updateSettings({ profile: { name: trimmedName } });
      const c = await api.createNode({ title: course.trim() || 'My course', kind: 'course' });
      const t = await api.createNode({
        title: task.trim() || 'First assignment',
        kind: 'task',
        parentId: c.node.id,
        estimatedMinutes: Math.max(0, Math.round(Number(hours || '0') * 60)) || null,
        dueAt: due ? localToIso(due) : null,
      });
      await api.updateMe({ onboarded: true });
      if (startNow) await api.startSession({ nodeId: t.node.id, mode: 'pomodoro' });
      await qc.invalidateQueries({ queryKey: keys.me });
      await qc.invalidateQueries({ queryKey: keys.nodes });
      await qc.invalidateQueries({ queryKey: keys.active });
      navigate('/', { replace: true });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  };

  const theme = me.data?.user.settings.theme.mode === 'light' ? 'light' : 'dark';

  return (
    <>
      <Backdrop backgroundId="aurora" theme={theme} />
      <main className="min-h-screen flex items-center justify-center p-4">
        <Glass className="p-8 w-full max-w-md flex flex-col gap-6" strong>
          <div className="flex gap-1" aria-label={`Step ${step + 1} of 4`}>
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className="h-1 flex-1 rounded-full"
                style={{ background: i <= step ? 'var(--accent)' : 'var(--border-strong)' }}
              />
            ))}
          </div>

          {step === 0 && (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                setStep(1);
              }}
            >
              <h1 className="text-2xl">What should we call you?</h1>
              <Input
                label="Name"
                hint="Only used to say hello on your Today page. Change it any time in settings."
                placeholder="e.g. Zach"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                autoFocus
                required
              />
              <Button type="submit" variant="primary" size="lg">
                Next
              </Button>
            </form>
          )}

          {step === 1 && (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                setStep(2);
              }}
            >
              <h1 className="text-2xl">What are you studying?</h1>
              <Input
                label="Course or subject"
                placeholder="e.g. EAS101"
                value={course}
                onChange={(e) => setCourse(e.target.value)}
                autoFocus
                required
              />
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button type="submit" variant="primary" size="lg" className="flex-1">
                  Next
                </Button>
              </div>
            </form>
          )}

          {step === 2 && (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                setStep(3);
              }}
            >
              <h1 className="text-2xl">What's the next thing due?</h1>
              <Input
                label="Title"
                placeholder="e.g. Homework 1"
                value={task}
                onChange={(e) => setTask(e.target.value)}
                autoFocus
                required
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Due"
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
                <Input
                  label="Rough hours"
                  type="number"
                  min={0}
                  step={0.5}
                  inputMode="decimal"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button type="submit" variant="primary" size="lg" className="flex-1">
                  Next
                </Button>
              </div>
            </form>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-4">
              <h1 className="text-2xl">Ready{name.trim() ? `, ${name.trim()}` : ''}.</h1>
              <p className="muted">
                {task || 'First assignment'} in {course || 'your course'}, due {due}, about{' '}
                {hours || 0} h. Start a 25-minute focus block now, or set things up first.
              </p>
              <Button variant="primary" size="lg" loading={busy} onClick={() => finish(true)}>
                Start
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => finish(false)}>
                Skip for now
              </Button>
            </div>
          )}
        </Glass>
      </main>
    </>
  );
}
