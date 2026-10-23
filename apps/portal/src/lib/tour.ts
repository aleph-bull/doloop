import type { OnboardingAnswers } from '@komogon/core';
import { useSyncExternalStore } from 'react';
import { api } from './api';
import { useMe } from './queries';

/**
 * Where a first-time setup is once the questions are done: the look around (a stop on each
 * page), the timelapse, then the last dialog. Kept in this browser so a reload carries on;
 * the questions themselves are on /onboarding, before the account counts as set up.
 */
export type TourStage =
  { stage: 'tour'; stop: number } | { stage: 'timelapse' } | { stage: 'finish' };

type Saved = TourStage & { userId: string };

const KEY = 'komogon.tour';

function read(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

let current: Saved | null = read();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setTour(userId: string, next: TourStage | null) {
  current = next ? { ...next, userId } : null;
  try {
    if (current) localStorage.setItem(KEY, JSON.stringify(current));
    else localStorage.removeItem(KEY);
  } catch {
    // Private windows: the tour still runs, it just won't survive a reload.
  }
  listeners.forEach((l) => l());
}

/** The signed-in person's stage, or null when no tour is running for them. */
export function useTour(): TourStage | null {
  const userId = useMe().data?.user.id;
  const saved = useSyncExternalStore(subscribe, () => current);
  return saved && saved.userId === userId ? saved : null;
}

/** Answers are for whoever runs Komodon; a failed save never holds anyone up. */
export function saveAnswers(patch: OnboardingAnswers) {
  void api.saveOnboarding(patch).catch(() => undefined);
}
