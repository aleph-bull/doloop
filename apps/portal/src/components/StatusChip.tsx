import type { PaceStatus } from '@komogon/core';
import { Chip, type ChipTone } from '@komogon/ui';

const MAP: Record<PaceStatus, { label: string; tone: ChipTone }> = {
  done: { label: 'Done', tone: 'ok' },
  'on-track': { label: 'On track', tone: 'ok' },
  behind: { label: 'Behind', tone: 'warn' },
  critical: { label: 'Critical', tone: 'bad' },
  overdue: { label: 'Overdue', tone: 'bad' },
  'no-estimate': { label: 'No estimate', tone: 'neutral' },
};

export function StatusChip({ status }: { status: PaceStatus }) {
  const m = MAP[status];
  return (
    <Chip tone={m.tone} dot>
      {m.label}
    </Chip>
  );
}
