import { addDays, parseStudyList, studyKey, studyListPrompt } from '@komogon/core';
import { Copy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Modal, Textarea, useToast } from '@komogon/ui';
import { fmtDate, fmtMinutes, fmtTime, isoToLocalDate, localToIso } from '../lib/format';
import { useImportNodes, useNodes } from '../lib/queries';

export interface PasteListDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called once a list has been added. */
  onAdded?: () => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * A whole term's deadlines in one go. Komodon has no AI of its own: it hands over a prompt
 * for the chat you already use, and reads back the list that chat writes (or one typed by
 * hand). Everything shows before it is added, and nothing is added twice.
 */
export function PasteListDialog({ open, onClose, onAdded }: PasteListDialogProps) {
  const { toast } = useToast();
  const nodes = useNodes();
  const add = useImportNodes();
  const [text, setText] = useState('');
  /** Shown when the browser won't let the prompt be copied, so it can be copied by hand. */
  const [promptShown, setPromptShown] = useState(false);
  const today = isoToLocalDate(new Date().toISOString());
  const prompt = studyListPrompt(today);

  useEffect(() => {
    if (!open) return;
    setText('');
    setPromptShown(false);
  }, [open]);

  const list = useMemo(() => parseStudyList(text, today), [text, today]);
  const existing = useMemo(
    () =>
      new Set((nodes.data?.nodes ?? []).filter((n) => !n.parentId).map((n) => studyKey(n.title))),
    [nodes.data],
  );
  const items = list.courses.reduce((n, c) => n + c.items.length, 0);
  const newCourses = list.courses.filter((c) => !existing.has(studyKey(c.title))).length;

  const placeholder = useMemo(
    () =>
      [
        `MAT137 | Problem set 3 | ${addDays(today, 9)} | 3`,
        `ECO101 | Midterm | ${addDays(today, 16)} 14:00 | 6`,
        '',
        'or by hand: CSC148 lab 5 due Nov 6',
      ].join('\n'),
    [today],
  );

  const copyPrompt = () =>
    navigator.clipboard
      .writeText(prompt)
      .then(() => toast('Prompt copied', { tone: 'ok' }))
      .catch(() => setPromptShown(true));

  const submit = async () => {
    try {
      const res = await add.mutateAsync({
        courses: list.courses.map((c) => ({
          title: c.title,
          items: c.items.map((i) => ({
            title: i.title,
            kind: i.kind,
            dueAt: i.dueDate ? localToIso(i.dueDate, i.dueTime ?? '23:59') : null,
            estimatedMinutes: i.estimatedMinutes,
          })),
        })),
      });
      const added = [
        res.courses > 0 ? plural(res.courses, 'course') : null,
        res.items > 0 ? plural(res.items, 'item') : null,
      ].filter(Boolean);
      toast(
        added.length === 0
          ? 'All of that was already in Tasks.'
          : `Added ${added.join(' and ')}.${res.skipped > 0 ? ` ${res.skipped} already there.` : ''}`,
        { tone: 'ok' },
      );
      onAdded?.();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add that list');
    }
  };

  const due = (date: string | null, time: string | null) => {
    if (!date) return null;
    const iso = localToIso(date, time ?? '23:59');
    const day = fmtDate(iso, date.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' });
    return time ? `${day}, ${fmtTime(iso)}` : day;
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Paste your deadlines"
      className="paste-dialog"
      actions={
        <>
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={add.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            loading={add.isPending}
            disabled={list.courses.length === 0}
          >
            {items > 0
              ? `Add ${plural(items, 'item')}`
              : newCourses > 0
                ? `Add ${plural(newCourses, 'course')}`
                : 'Add'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-2 items-center flex-wrap">
          <Button size="sm" variant="secondary" onClick={copyPrompt}>
            <Copy size={14} aria-hidden /> Copy a prompt for your AI
          </Button>
          <span className="muted text-sm">
            Paste it into ChatGPT or Claude with your course outlines, then paste its answer here.
          </span>
        </div>
        {promptShown && (
          <Textarea
            label="The prompt"
            hint="Your browser wouldn't let us copy it, so here it is to copy yourself."
            rows={5}
            value={prompt}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
        <Textarea
          label="Your list"
          hint="One item per line: Course | Item | Due | Hours. Only the course is needed."
          rows={7}
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          autoFocus
        />

        {text.trim() && (
          <div className="paste-preview" aria-live="polite">
            {list.courses.length === 0 ? (
              <p className="muted text-sm">Nothing to add from that yet.</p>
            ) : (
              <ul className="paste-courses">
                {list.courses.map((c) => (
                  <li key={studyKey(c.title)}>
                    <div className="paste-course">
                      <span className="paste-course-title">{c.title}</span>
                      <span className="muted text-sm">
                        {existing.has(studyKey(c.title)) ? 'Already in Tasks' : 'New course'}
                      </span>
                    </div>
                    {c.items.length > 0 && (
                      <ul className="paste-items">
                        {c.items.map((i) => (
                          <li key={i.line} className="paste-item">
                            <span className="paste-item-title">{i.title}</span>
                            {i.kind === 'assessment' && <span className="tt-kind">Assessment</span>}
                            <span className="paste-item-meta tabular">
                              {[
                                due(i.dueDate, i.dueTime),
                                i.estimatedMinutes !== null ? fmtMinutes(i.estimatedMinutes) : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {list.problems.length > 0 && (
              <details className="paste-problems">
                <summary>
                  {list.problems.length === 1
                    ? '1 line to check'
                    : `${list.problems.length} lines to check`}
                </summary>
                <ul>
                  {list.problems.map((p, n) => (
                    <li key={`${p.line}-${n}`}>
                      <span className="muted tabular">Line {p.line}</span> {p.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
