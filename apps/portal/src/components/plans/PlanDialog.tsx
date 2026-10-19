import { parseOutline } from '@komogon/core';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Input, Modal, Segmented, Textarea, Toggle, useToast } from '@komogon/ui';
import type { PlanInput } from '../../lib/api';
import { fmtHours } from '../../lib/format';

interface Row {
  key: number;
  title: string;
  hours: string;
  resource: string;
  practice: boolean;
}

let nextKey = 1;
const blankRow = (): Row => ({
  key: nextKey++,
  title: '',
  hours: '',
  resource: '',
  practice: true,
});

const PLACEHOLDER = `| Topic | Hours | Resource |
| Ser vs estar | 4 | Grammar book ch. 3 |
| Past tenses | 6 | Duolingo unit 4 |

or one per line: Conversational basics - 6h - podcast season 1`;

/** A prompt to hand to any AI chat, asking for an outline in the exact shape the paste box reads. */
function aiPrompt(title: string, weeklyHours: string, target: string): string {
  const subject = title.trim() || '[what you are learning]';
  const weekly = Number(weeklyHours) || 0;
  const budget = [
    weekly > 0 ? `I can give it about ${weekly} hours a week` : null,
    target ? `I want to be done by ${target}` : null,
  ]
    .filter(Boolean)
    .join(', and ');
  return `I'm making a study plan for: ${subject}.
${budget ? `${budget}.\n` : ''}Resources I already have: [list them here, or write "find them for me"]

Break it into the topics I should work through, in the order I should learn them. For each topic, estimate the hours it needs and name one specific resource (a book chapter, course module, video series or link).
${weekly > 0 && target ? 'Keep the total hours realistic for my weekly time and date.\n' : ''}
About resources:
- If I listed some, use those first and point to the exact part (chapter, module, unit).
- If I asked you to find them, choose well-known, specific ones that you are confident exist.
- If that line is blank or still in brackets, or you are not sure what fits a topic, ask me before you make the table. Never invent a resource.

When you give me the plan, reply with only this table, nothing before or after it:

| Topic | Hours | Resource |
| --- | --- | --- |
| First topic | 4 | Specific resource |
| Second topic | 6 | Specific resource |

Keep each topic name short. Hours are a plain number.`;
}

export interface PlanDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: PlanInput) => Promise<void>;
  busy: boolean;
}

/**
 * A new plan, two ways in: paste an outline you already have (a table, a list, a syllabus)
 * and it is read into topics, or build the topics row by row. Either way the rows are
 * editable before anything is saved, and both end in the same plan.
 */
export function PlanDialog({ open, onClose, onCreate, busy }: PlanDialogProps) {
  const { toast } = useToast();
  const [mode, setMode] = useState<'paste' | 'build'>('build');
  const [title, setTitle] = useState('');
  const [weeklyHours, setWeeklyHours] = useState('10');
  const [target, setTarget] = useState('');
  const [method, setMethod] = useState('');
  const [outline, setOutline] = useState('');
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [topUp, setTopUp] = useState(false);
  const [topUpTitle, setTopUpTitle] = useState('Re-drill misses');
  const [topUpMinutes, setTopUpMinutes] = useState('15');

  useEffect(() => {
    if (!open) return;
    setMode('build');
    setTitle('');
    setWeeklyHours('10');
    setTarget('');
    setMethod('');
    setOutline('');
    setRows([blankRow()]);
    setTopUp(false);
  }, [open]);

  const readOutline = () => {
    const parsed = parseOutline(outline);
    if (parsed.length === 0) {
      toast('Nothing to read there yet: one topic per line works.');
      return;
    }
    setRows(
      parsed.map((p) => ({
        key: nextKey++,
        title: p.title,
        hours: p.minutes !== null ? String(+(p.minutes / 60).toFixed(2)) : '',
        resource: p.resource ?? '',
        practice: true,
      })),
    );
    setMode('build');
  };

  const copyPrompt = () =>
    navigator.clipboard
      .writeText(aiPrompt(title, weeklyHours, target))
      .then(() => toast('Prompt copied', { tone: 'ok' }))
      .catch(() => toast('Could not copy'));

  const patchRow =(key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const topics = rows.filter((r) => r.title.trim());
  const totalMinutes = topics.reduce((s, r) => s + (Number(r.hours) || 0) * 60, 0);
  const weekly = Number(weeklyHours) || 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'paste') {
      readOutline();
      return;
    }
    if (topics.length === 0) {
      toast('Add at least one topic.');
      return;
    }
    if (weekly <= 0) {
      toast('A weekly budget needs a number of hours.');
      return;
    }
    await onCreate({
      title: title.trim(),
      weeklyMinutes: Math.round(weekly * 60),
      targetDate: target || null,
      method: method.trim() || null,
      topics: topics.map((r) => ({
        title: r.title.trim(),
        plannedMinutes: Math.round((Number(r.hours) || 0) * 60),
        resource: r.resource.trim() || null,
        practice: r.practice,
      })),
      maintenance:
        topUp && topUpTitle.trim()
          ? { title: topUpTitle.trim(), minutes: Math.max(1, Number(topUpMinutes) || 15) }
          : null,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New study plan"
      className="plan-dialog"
      actions={
        <>
          {mode === 'build' && totalMinutes > 0 && (
            <span className="muted text-sm tabular">
              {fmtHours(totalMinutes)} planned
              {weekly > 0 &&
                ` · about ${Math.max(1, Math.round((totalMinutes / 60 / weekly) * 10) / 10)} weeks`}
            </span>
          )}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="plan-form" variant="primary" loading={busy}>
            {mode === 'paste' ? 'Read topics' : 'Create plan'}
          </Button>
        </>
      }
    >
      <form id="plan-form" className="flex flex-col gap-4" onSubmit={submit}>
        <Input
          label="What are you learning?"
          placeholder="e.g. IB technicals, conversational Spanish, AWS cert"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={200}
          autoFocus
        />
        <div className="plan-dialog-pair">
          <Input
            label="Hours a week"
            type="number"
            min={0.25}
            step="0.25"
            inputMode="decimal"
            value={weeklyHours}
            onChange={(e) => setWeeklyHours(e.target.value)}
            required
          />
          <Input
            label="Target date (optional)"
            type="date"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </div>

        <Segmented
          ariaLabel="How to add topics"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'build', label: 'Build it' },
            { value: 'paste', label: 'Paste an outline' },
          ]}
        />

        {mode === 'paste' ? (
          <div className="flex flex-col gap-2">
            <Textarea
              label="Your topics"
              hint="A table, a list, a syllabus. Hours and resources are picked up when they are there."
              rows={8}
              placeholder={PLACEHOLDER}
              value={outline}
              onChange={(e) => setOutline(e.target.value)}
            />
            <div className="flex gap-2 items-center flex-wrap">
              <Button size="sm" variant="secondary" onClick={copyPrompt}>
                <Copy size={14} aria-hidden /> Copy a prompt for your AI
              </Button>
              <span className="muted text-sm">
                Paste it into ChatGPT or Claude, fill in your resources, then paste the table back here.
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="plan-rows-head muted text-sm" aria-hidden>
              <span>Topic</span>
              <span>Hours</span>
              <span>Resource</span>
              <span title="Drilled with questions and marked right, shaky or missed">Drills</span>
              <span />
            </div>
            <ol className="plan-rows">
              {rows.map((r, i) => (
                <li key={r.key} className="plan-row-edit">
                  <Input
                    aria-label={`Topic ${i + 1}`}
                    placeholder={`Topic ${i + 1}`}
                    value={r.title}
                    onChange={(e) => patchRow(r.key, { title: e.target.value })}
                  />
                  <Input
                    aria-label={`Hours for topic ${i + 1}`}
                    type="number"
                    min={0}
                    step="0.25"
                    inputMode="decimal"
                    placeholder="h"
                    value={r.hours}
                    onChange={(e) => patchRow(r.key, { hours: e.target.value })}
                  />
                  <Input
                    aria-label={`Resource for topic ${i + 1}`}
                    placeholder="Book, module, link"
                    value={r.resource}
                    onChange={(e) => patchRow(r.key, { resource: e.target.value })}
                  />
                  <button
                    type="button"
                    role="switch"
                    className="toggle"
                    aria-checked={r.practice}
                    aria-label={`Drill topic ${i + 1} with questions`}
                    onClick={() => patchRow(r.key, { practice: !r.practice })}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    aria-label={`Remove topic ${i + 1}`}
                    disabled={rows.length === 1}
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  >
                    <Trash2 size={14} aria-hidden />
                  </Button>
                </li>
              ))}
            </ol>
            <div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setRows((rs) => [...rs, blankRow()])}
              >
                <Plus size={14} aria-hidden /> Add a topic
              </Button>
            </div>

            <Textarea
              label="How you work each topic (optional)"
              placeholder="Warm up with notes, cold drill out loud, re-read only the misses, redo them tomorrow."
              rows={2}
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            />

            <Toggle
              checked={topUp}
              onChange={setTopUp}
              label="A daily top-up"
              description="A short routine every day alongside the topics, like re-drilling misses."
            />
            {topUp && (
              <div className="plan-dialog-pair">
                <Input
                  label="Top-up"
                  value={topUpTitle}
                  onChange={(e) => setTopUpTitle(e.target.value)}
                  maxLength={200}
                />
                <Input
                  label="Minutes a day"
                  type="number"
                  min={1}
                  value={topUpMinutes}
                  onChange={(e) => setTopUpMinutes(e.target.value)}
                />
              </div>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}
