import type { PlanPaceStatus } from '@komogon/core';
import { Chip, type ChipTone } from '@komogon/ui';

const LABEL: Record<PlanPaceStatus, { text: string; tone: ChipTone } | null> = {
  done: { text: 'All learned', tone: 'ok' },
  ahead: { text: 'Ahead', tone: 'ok' },
  'on-track': { text: 'On track', tone: 'accent' },
  // Said plainly, without alarm: the plan page offers the ways back.
  behind: { text: 'Needs more time', tone: 'warn' },
  'no-target': null,
};

export function PlanStatus({ status }: { status: PlanPaceStatus }) {
  const l = LABEL[status];
  return l ? <Chip tone={l.tone}>{l.text}</Chip> : null;
}
