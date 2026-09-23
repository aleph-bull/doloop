import {
  diffDays,
  pickGreeting,
  standsInForChildren,
  startOfWeekMonday,
  toLocalDate,
  type NodePace,
  type PickedGreeting,
  type Session,
  type StudyNode,
} from '@komodoit/core';
import { useMemo } from 'react';

/** Items due within this many days are worth greeting someone about. */
const DUE_SOON_DAYS = 3;

export interface GreetingInput {
  name: string | null;
  streak: number;
  sessions: Session[];
  nodes: StudyNode[];
  pace: Record<string, NodePace>;
  /** Injectable for tests; defaults to the real clock. */
  now?: Date;
}

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The greeting on Today. Signals come from data the page already has, so this costs no
 * extra request. The seed is the local date plus the bucket, which means one greeting per
 * day rather than a new one on every render.
 */
export function buildGreeting(input: GreetingInput): PickedGreeting {
  const now = input.now ?? new Date();
  const zone = tz();
  const today = toLocalDate(now, zone);
  const weekStart = startOfWeekMonday(today);

  let minutesToday = 0;
  let minutesThisWeek = 0;
  let lastDate: string | null = null;
  let ever = 0;

  for (const s of input.sessions) {
    if (!s.endedAt) continue;
    ever++;
    const day = toLocalDate(s.startedAt, zone);
    if (!lastDate || day > lastDate) lastDate = day;
    const minutes = s.workSeconds / 60;
    if (day === today) minutesToday += minutes;
    if (day >= weekStart && day <= today) minutesThisWeek += minutes;
  }

  const dueSoon = input.nodes
    .filter((n) => {
      if (!n.dueAt || n.completedAt || n.archived || n.kind === 'course') return false;
      const p = input.pace[n.id];
      // A parent standing in for its children is not the thing you would sit down to do.
      if (p && standsInForChildren(p)) return false;
      const days = diffDays(today, toLocalDate(n.dueAt, zone));
      return days >= 0 && days <= DUE_SOON_DAYS;
    })
    .sort((a, b) => (a.dueAt! < b.dueAt! ? -1 : 1))
    .map((n) => ({ title: n.title }));

  return pickGreeting({
    name: input.name,
    seed: today,
    localHour: now.getHours(),
    dayOfWeek: now.getDay(),
    streak: input.streak,
    minutesToday,
    minutesThisWeek,
    sessionsEver: ever,
    daysSinceLastSession: lastDate ? diffDays(lastDate, today) : null,
    dueSoon,
  });
}

export function useGreeting(input: GreetingInput): PickedGreeting {
  const { name, streak, sessions, nodes, pace } = input;
  return useMemo(
    () => buildGreeting({ name, streak, sessions, nodes, pace }),
    [name, streak, sessions, nodes, pace],
  );
}
