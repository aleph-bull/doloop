import { formatClock, type Distracted, type ReviewMode, type StudyNode } from '@komogon/core';
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Input, Modal, Reveal, Textarea, Toggle } from '@komogon/ui';
import type { ReviewInput } from '../lib/api';

/**
 * What the session was for. A routine has no estimate to revise and nothing to be
 * prepared for, and "done" means ticking off this occurrence.
 */
export type ReviewSubject = { kind: 'task'; node: StudyNode } | { kind: 'routine'; title: string };

/** The session as it stands when it is stopped: the numbers the sheet leads with. */
export interface ReviewStats {
  workSeconds: number;
  breakSeconds: number;
  /** Completed work intervals, for a pomodoro session; null otherwise. */
  pomodoros: number | null;
}

export interface ReviewDialogProps {
  open: boolean;
  mode: Exclude<ReviewMode, 'off'>;
  subject: ReviewSubject;
  /** Where the task sits, "ECO220 › Unit 1", for the header. */
  path?: string;
  stats: ReviewStats;
  /** True if the node or an ancestor is an assessment (asks how prepared you feel). */
  underAssessment: boolean;
  /** The assessment that readiness is asked about; the task itself if it is one. */
  assessmentTitle?: string | null;
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

const FOCUS: Array<{ value: Distracted; label: string }> = [
  { value: 'no', label: 'Locked in' },
  { value: 'a-little', label: 'A few drifts' },
  { value: 'a-lot', label: 'Scattered' },
];
const EFFORT = ['Easy', 'Moderate', 'Hard', 'Very hard', 'All out'];
const PREPARED = ['Not yet', 'Shaky', 'Getting there', 'Mostly', 'Ready'];
/** The "Custom" choice: any amount, typed in. */
const CUSTOM_MORE = -1;
const MORE_TIME: Array<{ minutes: number; label: string }> = [
  { minutes: 0, label: 'No' },
  { minutes: 30, label: '+30 min' },
  { minutes: 60, label: '+1 h' },
  { minutes: 120, label: '+2 h' },
  { minutes: CUSTOM_MORE, label: 'Custom' },
];
/** The most a custom answer may add: a hundred hours. */
const MAX_CUSTOM_MINUTES = 6000;

/**
 * Minutes from what was typed: "45", "45 min", "1.5 h", "3h", "1h 30", "1:30". A bare
 * number is minutes. Null when it can't be read or isn't more than nothing.
 */
export function parseMoreTime(text: string): number | null {
  const t = text.trim().toLowerCase().replace(',', '.');
  if (!t) return null;
  let minutes: number | null = null;
  const clock = /^(\d+):(\d{1,2})$/.exec(t);
  const hm = /^(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\s*(?:(\d+)\s*m(?:in(?:utes?|s)?)?)?$/.exec(t);
  const hThenMin = /^(\d+)\s*h\s*(\d+)$/.exec(t);
  const m = /^(\d+(?:\.\d+)?)\s*(?:m|min|mins|minutes?)?$/.exec(t);
  if (clock) minutes = Number(clock[1]) * 60 + Number(clock[2]);
  else if (hThenMin) minutes = Number(hThenMin[1]) * 60 + Number(hThenMin[2]);
  else if (hm) minutes = Number(hm[1]) * 60 + (hm[2] ? Number(hm[2]) : 0);
  else if (m) minutes = Number(m[1]);
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.min(MAX_CUSTOM_MINUTES, Math.round(minutes));
}

/** "45 min", "3 h", "1 h 30 min", for the custom answer's hint. */
function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** A row of one-tap choices; tapping the chosen one again clears it. */
function Choices<T extends string | number>({
  label,
  value,
  options,
  onChange,
  scale = false,
}: {
  label: string;
  value: T | null;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T | null) => void;
  /** A graded scale: the chips fill up to the chosen one, like an effort bar. */
  scale?: boolean;
}) {
  const chosen = options.findIndex((o) => o.value === value);
  return (
    <div className="save-q">
      <span className="save-q-label">{label}</span>
      <div className={`save-chips${scale ? ' is-scale' : ''}`} role="radiogroup" aria-label={label}>
        {options.map((o, i) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            className={`save-chip${scale && chosen >= 0 && i <= chosen ? ' is-filled' : ''}`}
            onClick={() => onChange(o.value === value ? null : o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The end of a session, like saving a workout: the numbers first, then a few one-tap
 * questions, then Save, which hands over to the score sheet. Always skippable, and
 * skipping costs nothing (spec §5).
 */
export function ReviewDialog({
  open,
  mode,
  subject,
  path,
  stats,
  underAssessment,
  assessmentTitle,
  onSubmit,
  onSkip,
  busy,
}: ReviewDialogProps) {
  const [prepared, setPrepared] = useState<number | null>(null);
  const [distracted, setDistracted] = useState<Distracted | null>(null);
  const [effort, setEffort] = useState<number | null>(null);
  const [completed, setCompleted] = useState('');
  const [correct, setCorrect] = useState('');
  const [moreMinutes, setMoreMinutes] = useState<number | null>(null);
  const [customMore, setCustomMore] = useState('');
  const customMinutes = parseMoreTime(customMore);
  /** What the answer adds, whichever way it was given. */
  const extraMinutes = moreMinutes === CUSTOM_MORE ? customMinutes : moreMinutes;
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [markComplete, setMarkComplete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPrepared(null);
    setDistracted(null);
    setEffort(null);
    setCompleted('');
    setCorrect('');
    setMoreMinutes(null);
    setNoteOpen(false);
    setNote('');
    // Starting a routine's session is the intent to do it, so the tick starts on.
    setMarkComplete(subject.kind === 'routine');
  }, [open, subject.kind]);

  const node = subject.kind === 'task' ? subject.node : null;
  const title = node ? node.title : subject.kind === 'routine' ? subject.title : '';
  // Only a task that counts something asks how many.
  const unit = node?.countUnit
    ? node.countUnit === 'custom'
      ? node.countUnitLabel || 'items'
      : UNIT_LABEL[node.countUnit]
    : null;
  const gradable = node?.countUnit === 'problems' || node?.countUnit === 'cards';
  const completedNum = completed.trim() === '' ? null : Number(completed);
  const full = mode === 'full';

  const submit = () => {
    onSubmit(
      {
        skipped: false,
        prepared: underAssessment ? prepared : null,
        distracted,
        effort: full ? effort : null,
        completedCount: full && unit ? completedNum : null,
        correctCount:
          full && gradable && completedNum && correct.trim() !== '' ? Number(correct) : null,
        extraMinutesAdded: full && node && extraMinutes ? extraMinutes : null,
        note: full && note.trim() ? note.trim() : null,
      },
      markComplete,
    );
  };

  return (
    <Modal
      open={open}
      onClose={() => onSkip(markComplete)}
      className="save-sheet"
      actions={
        <>
          <Button variant="ghost" onClick={() => onSkip(markComplete)} disabled={busy}>
            Skip
          </Button>
          <Button variant="primary" size="lg" onClick={submit} loading={busy}>
            <Check size={17} aria-hidden /> Save session
          </Button>
        </>
      }
    >
      <div className="save">
        <header className="save-head">
          <span className="save-kicker">Session done</span>
          <h2 className="save-title">{title}</h2>
          {path && <span className="save-path">{path}</span>}
        </header>

        <dl className="save-stats">
          <div className="save-stat is-main">
            <dt>Focused</dt>
            <dd className="tabular">{formatClock(stats.workSeconds)}</dd>
          </div>
          {stats.breakSeconds > 0 && (
            <div className="save-stat">
              <dt>Breaks</dt>
              <dd className="tabular">{formatClock(stats.breakSeconds)}</dd>
            </div>
          )}
          {stats.breakSeconds > 0 && (
            <div className="save-stat">
              <dt>Elapsed</dt>
              <dd className="tabular">{formatClock(stats.workSeconds + stats.breakSeconds)}</dd>
            </div>
          )}
          {stats.pomodoros !== null && stats.pomodoros > 0 && (
            <div className="save-stat">
              <dt>Pomodoros</dt>
              <dd className="tabular">{stats.pomodoros}</dd>
            </div>
          )}
        </dl>

        <div className="save-qs">
          <Choices label="Focus" value={distracted} options={FOCUS} onChange={setDistracted} />
          {full && (
            <Choices
              label="Effort"
              value={effort}
              options={EFFORT.map((label, i) => ({ value: i + 1, label }))}
              onChange={setEffort}
              scale
            />
          )}
          {underAssessment && (
            <Choices
              label={`Ready for ${assessmentTitle ?? title}?`}
              value={prepared}
              options={PREPARED.map((label, i) => ({ value: i + 1, label }))}
              onChange={setPrepared}
              scale
            />
          )}

          {full && unit && (
            <div className="save-counts">
              <Input
                label={`${unit[0]!.toUpperCase()}${unit.slice(1)} done`}
                type="number"
                min={0}
                inputMode="numeric"
                value={completed}
                onChange={(e) => setCompleted(e.target.value)}
                placeholder="0"
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
                  placeholder="0"
                />
              )}
            </div>
          )}

          {full && node && (
            <div className="flex flex-col gap-2">
              <Choices
                label="Needs more time than planned?"
                value={moreMinutes}
                options={MORE_TIME.map((m) => ({ value: m.minutes, label: m.label }))}
                onChange={setMoreMinutes}
              />
              <Reveal open={moreMinutes === CUSTOM_MORE}>
                <Input
                  aria-label="How much more time"
                  placeholder="e.g. 45 min or 3 h"
                  value={customMore}
                  onChange={(e) => setCustomMore(e.target.value)}
                  hint={
                    customMore.trim() === ''
                      ? 'Minutes or hours.'
                      : customMinutes
                        ? `Adds ${formatMinutes(customMinutes)}.`
                        : 'Try "45 min" or "1.5 h".'
                  }
                />
              </Reveal>
            </div>
          )}

          {full && (
            <div className="save-note">
              <button
                type="button"
                className="save-note-toggle"
                aria-expanded={noteOpen}
                onClick={() => setNoteOpen(!noteOpen)}
              >
                <ChevronDown size={15} aria-hidden className="save-note-chevron" />
                Add a note
              </button>
              <Reveal open={noteOpen}>
                <Textarea
                  aria-label="Note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What went well, what to pick up next time"
                  maxLength={2000}
                />
              </Reveal>
            </div>
          )}

          <Toggle
            className="save-done"
            checked={markComplete}
            onChange={setMarkComplete}
            label={subject.kind === 'routine' ? 'Tick it off for today' : `Mark ${title} as done`}
          />
        </div>
      </div>
    </Modal>
  );
}
