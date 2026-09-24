import type { Distracted, ReviewMode, StudyNode } from '@komogon/core';
import { useEffect, useState } from 'react';
import { Button, Input, Modal, Segmented, Slider, Textarea, Toggle } from '@komogon/ui';
import type { ReviewInput } from '../lib/api';

/**
 * What the session was for. A routine has no estimate to revise and nothing to be
 * prepared for, and "done" means ticking off this occurrence.
 */
export type ReviewSubject = { kind: 'task'; node: StudyNode } | { kind: 'routine'; title: string };

export interface ReviewDialogProps {
  open: boolean;
  mode: Exclude<ReviewMode, 'off'>;
  subject: ReviewSubject;
  /** True if the node or an ancestor is an assessment (asks "Prepared"). */
  underAssessment: boolean;
  onSubmit: (review: ReviewInput, markComplete: boolean) => void;
  onSkip: (markComplete: boolean) => void;
  busy?: boolean;
}

const UNIT_LABEL: Record<NonNullable<StudyNode['countUnit']>, string> = {
  problems: 'problems',
  pages: 'pages',
  cards: 'cards',
  custom: 'items',
};

function Scale({
  label,
  value,
  onChange,
  low,
  high,
}: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
  low: string;
  high: string;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="flex gap-2" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            className="btn btn-secondary btn-sm"
            style={
              value === n
                ? {
                    background: 'var(--accent)',
                    color: 'var(--accent-fg)',
                    borderColor: 'transparent',
                  }
                : undefined
            }
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between field-hint">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

/** End-of-session review (spec §5). Always skippable, and skipping costs nothing. */
export function ReviewDialog({
  open,
  mode,
  subject,
  underAssessment,
  onSubmit,
  onSkip,
  busy,
}: ReviewDialogProps) {
  const [prepared, setPrepared] = useState<number | null>(null);
  const [distracted, setDistracted] = useState<Distracted | ''>('');
  const [completed, setCompleted] = useState('');
  const [correct, setCorrect] = useState('');
  const [mood, setMood] = useState<number | null>(null);
  const [needsMore, setNeedsMore] = useState(false);
  const [extraHours, setExtraHours] = useState(1);
  const [note, setNote] = useState('');
  const [markComplete, setMarkComplete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPrepared(null);
    setDistracted('');
    setCompleted('');
    setCorrect('');
    setMood(null);
    setNeedsMore(false);
    setExtraHours(1);
    setNote('');
    // Starting a routine's session is the intent to do it, so the tick starts on.
    setMarkComplete(subject.kind === 'routine');
  }, [open, subject.kind]);

  const node = subject.kind === 'task' ? subject.node : null;
  const title = node ? node.title : subject.kind === 'routine' ? subject.title : '';
  const unit = node?.countUnit
    ? node.countUnit === 'custom'
      ? node.countUnitLabel || 'items'
      : UNIT_LABEL[node.countUnit]
    : 'activities';
  const gradable = node?.countUnit === 'problems' || node?.countUnit === 'cards';
  const completedNum = completed.trim() === '' ? null : Number(completed);

  const submit = () => {
    onSubmit(
      {
        skipped: false,
        prepared: underAssessment ? prepared : null,
        distracted: distracted || null,
        completedCount: mode === 'full' ? completedNum : null,
        correctCount:
          mode === 'full' && gradable && completedNum && correct.trim() !== ''
            ? Number(correct)
            : null,
        mood: mode === 'full' ? mood : null,
        extraMinutesAdded:
          mode === 'full' && node && needsMore ? Math.round(extraHours * 60) : null,
        note: mode === 'full' && note.trim() ? note.trim() : null,
      },
      markComplete,
    );
  };

  return (
    <Modal
      open={open}
      onClose={() => onSkip(markComplete)}
      title="How did it go?"
      actions={
        <>
          <Button variant="ghost" onClick={() => onSkip(markComplete)} disabled={busy}>
            Skip
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {underAssessment && (
          <Scale
            label={`How prepared do you feel for ${title}?`}
            value={prepared}
            onChange={setPrepared}
            low="Not yet"
            high="Ready"
          />
        )}
        <div className="field">
          <span className="field-label">Distracted?</span>
          <Segmented
            ariaLabel="Distracted"
            value={distracted || 'unset'}
            onChange={(v) => setDistracted(v === 'unset' ? '' : (v as Distracted))}
            options={[
              { value: 'no', label: 'No' },
              { value: 'a-little', label: 'A little' },
              { value: 'a-lot', label: 'A lot' },
            ]}
          />
        </div>

        {mode === 'full' && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label={`${unit[0]?.toUpperCase()}${unit.slice(1)} completed`}
                type="number"
                min={0}
                inputMode="numeric"
                value={completed}
                onChange={(e) => setCompleted(e.target.value)}
                placeholder="optional"
              />
              {gradable && completedNum != null && completedNum > 0 && (
                <Input
                  label="Of those, correct"
                  type="number"
                  min={0}
                  max={completedNum}
                  inputMode="numeric"
                  value={correct}
                  onChange={(e) => setCorrect(e.target.value)}
                  placeholder="optional"
                />
              )}
            </div>
            <Scale
              label="Mood after this session"
              value={mood}
              onChange={setMood}
              low="Low"
              high="Great"
            />
            {node && (
              <Toggle
                checked={needsMore}
                onChange={setNeedsMore}
                label="Needs more time than planned?"
                description="Adds hours to the estimate so your pace stays honest."
              />
            )}
            {node && needsMore && (
              <div className="field">
                <span className="field-label">How many extra hours? {extraHours}</span>
                <Slider
                  min={0.5}
                  max={20}
                  step={0.5}
                  value={extraHours}
                  onChange={setExtraHours}
                  aria-label="Extra hours"
                />
              </div>
            )}
            <Textarea
              label="Note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="optional"
              rows={2}
            />
          </>
        )}

        {subject.kind === 'routine' ? (
          <Toggle
            checked={markComplete}
            onChange={setMarkComplete}
            label={`Tick off "${title}"`}
            description="Leave it off if you did not finish; it stays on your list."
          />
        ) : (
          !subject.node.completedAt && (
            <Toggle
              checked={markComplete}
              onChange={setMarkComplete}
              label={`Mark "${title}" as done`}
            />
          )
        )}
      </div>
    </Modal>
  );
}
