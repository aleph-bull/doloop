import { useSyncExternalStore } from 'react';

/**
 * The background's blur and brightness while someone moves them (Settings › Appearance).
 * The Backdrop shows them straight away, the blur with the browser's own; the photo is
 * blurred for good once, when Appearance is left, not on every step.
 */
export interface BackdropDraft {
  blur?: number;
  brightness?: number;
  /** Appearance was left: the Backdrop blurs the photo at this, then lets the draft go. */
  done: boolean;
}

let draft: BackdropDraft | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Show the background with these while they are being moved. */
export function tuneBackdrop(next: { blur?: number; brightness?: number }): void {
  draft = { ...draft, ...next, done: false };
  emit();
}

/** Leaving Appearance: the Backdrop now blurs the photo once at what was last shown. */
export function finishBackdropTuning(): void {
  if (!draft || draft.done) return;
  draft = { ...draft, done: true };
  emit();
}

/** The Backdrop, once the saved settings show what the draft did. */
export function clearBackdropDraft(): void {
  if (!draft) return;
  draft = null;
  emit();
}

export function useBackdropDraft(): BackdropDraft | null {
  return useSyncExternalStore(
    subscribe,
    () => draft,
    () => null,
  );
}
