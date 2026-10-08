import { useToast } from '@komogon/ui';
import { useEffect } from 'react';

/**
 * Undo and redo for the small, reversible things: ticking a task or routine, editing or
 * adding a task, archiving one, logging a tracker, planning a block. Ctrl+Z takes the last
 * one back and Ctrl+Y (or Ctrl+Shift+Z) puts it back again.
 *
 * Each entry carries its own inverse, so undoing is one more ordinary API call, never a
 * replay of state. Nothing weighty is recorded here: settings, rewards, purchases, imports,
 * account changes and anything that touches many rows at once stay as they were done. A
 * mistake there is fixed on its own page, on purpose, not by a reflex keystroke.
 *
 * The stack lives for the tab. A reload starts it empty, and the shortcut is ignored
 * while the browser's own undo is the right one: in a text field, or with a dialog open.
 */
export interface UndoEntry {
  /** What was done, in the past tense: "Marked Essay done". Shown in the toast. */
  label: string;
  undo: () => Promise<unknown>;
  redo: () => Promise<unknown>;
}

const LIMIT = 50;
let past: UndoEntry[] = [];
let future: UndoEntry[] = [];
let inFlight = false;

/** Remember something that can be taken back. Clears whatever could have been redone. */
export function recordUndo(entry: UndoEntry): void {
  past.push(entry);
  if (past.length > LIMIT) past.shift();
  future = [];
}

export function undoDepth(): number {
  return past.length;
}

/** Take the last thing back. Resolves with what was undone, or null when there was nothing. */
export async function undo(): Promise<UndoEntry | null> {
  if (inFlight) return null;
  const entry = past.pop();
  if (!entry) return null;
  inFlight = true;
  try {
    // If it does not come back, it stays off the stack rather than being offered again.
    await entry.undo();
    future.push(entry);
    return entry;
  } finally {
    inFlight = false;
  }
}

export async function redo(): Promise<UndoEntry | null> {
  if (inFlight) return null;
  const entry = future.pop();
  if (!entry) return null;
  inFlight = true;
  try {
    await entry.redo();
    past.push(entry);
    return entry;
  } finally {
    inFlight = false;
  }
}

/** For tests and sign-out: forget everything. */
export function clearUndo(): void {
  past = [];
  future = [];
}

/** True where a keystroke belongs to the thing being typed in, not to the app. */
export function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

/** Which of the two the keystroke asks for, or null for any other key. */
export function undoKey(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !e.shiftKey) return 'redo';
  return null;
}

/** Mount once in the shell: Ctrl+Z and Ctrl+Y for the whole app. */
export function useUndoShortcuts(): void {
  const { toast } = useToast();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const which = undoKey(e);
      if (!which || e.defaultPrevented || isTextTarget(e.target)) return;
      // A dialog has its own idea of what Escape and Ctrl+Z mean.
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      const run = which === 'undo' ? undo() : redo();
      void run
        .then((entry) => {
          if (entry) toast(`${which === 'undo' ? 'Undone' : 'Redone'}: ${entry.label}`);
          else toast(which === 'undo' ? 'Nothing to undo' : 'Nothing to redo');
        })
        .catch((err) =>
          toast(err instanceof Error ? err.message : `Could not ${which} that`, {
            tone: 'warn',
          }),
        );
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toast]);
}
