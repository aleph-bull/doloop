import { badgeByKey, levelProgress } from '@doloop/core';
import { useEffect } from 'react';
import { Button, fireConfetti, Modal, ProgressBar, useToast } from '@doloop/ui';
import type { EndSummary } from '../lib/api';
import { fmtMinutes } from '../lib/format';

export interface RewardOverlayProps {
  summary: EndSummary | null;
  onClose: () => void;
  phrasesEnabled: boolean;
  badgeToasts?: boolean;
}

/** Rewards + summary after a session (spec §6, §7). */
export function RewardOverlay({
  summary,
  onClose,
  phrasesEnabled,
  badgeToasts = true,
}: RewardOverlayProps) {
  const { toast } = useToast();
  useEffect(() => {
    if (summary?.confetti) fireConfetti();
    if (summary && badgeToasts) {
      for (const key of summary.badges) {
        const b = badgeByKey(key);
        if (b) toast(`Badge unlocked: ${b.name}`, { tone: 'ok', durationMs: 5000 });
      }
    }
  }, [summary, badgeToasts, toast]);

  if (!summary) return null;
  const lp = levelProgress(summary.xpTotal);
  const x = summary.xp;
  const lines: Array<[string, number]> = [
    ['Effort', x.base],
    ['Review', x.reviewSubmitted],
    ['Focus', x.focus],
    ['Planned block', x.plannedBlock],
    ['On pace', x.onPace],
    ['Beat the estimate', x.estimateBeat],
  ];

  return (
    <Modal
      open
      onClose={onClose}
      actions={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        {phrasesEnabled && summary.phrase && (
          <h2 className="text-2xl leading-tight">{summary.phrase.text}</h2>
        )}
        {!phrasesEnabled && <h2 className="text-2xl">Session saved</h2>}

        <div className="flex items-baseline gap-3">
          <span className="reward-xp">+{x.total}</span>
          <span className="muted">XP</span>
          {summary.leveledUp && <span className="chip chip-ok">Level {summary.levelAfter}</span>}
        </div>

        <div>
          <ProgressBar value={lp.ratio} label="Progress to next level" />
          <div className="flex justify-between text-xs muted mt-1 tabular">
            <span>Level {lp.level}</span>
            <span>
              {lp.toNext} XP to level {lp.level + 1}
            </span>
          </div>
        </div>

        <ul className="text-sm grid grid-cols-2 gap-x-6 gap-y-1">
          {lines
            .filter(([, v]) => v > 0)
            .map(([k, v]) => (
              <li key={k} className="flex justify-between">
                <span className="muted">{k}</span>
                <span className="tabular">+{v}</span>
              </li>
            ))}
          {x.streakMult > 1 && (
            <li
              className="flex justify-between col-span-2 border-t pt-1 mt-1"
              style={{ borderColor: 'var(--border)' }}
            >
              <span className="muted">Streak bonus</span>
              <span className="tabular">×{x.streakMult.toFixed(2)}</span>
            </li>
          )}
        </ul>

        <div className="text-sm muted flex flex-col gap-1">
          <span>
            {fmtMinutes(summary.session.workSeconds / 60)} of focused work
            {summary.session.breakSeconds > 0 &&
              `, ${fmtMinutes(summary.session.breakSeconds / 60)} on break`}
            {summary.session.idleSeconds > 0 &&
              `, ${fmtMinutes(summary.session.idleSeconds / 60)} idle`}
          </span>
          <span>
            Streak: {summary.streak.current} day{summary.streak.current === 1 ? '' : 's'}
            {summary.streak.milestonesReached.length > 0 && ' · milestone reached'}
          </span>
          {summary.streak.message && <span>{summary.streak.message}</span>}
          {summary.nodeCompleted && <span>Marked as done.</span>}
          {summary.badges.length > 0 && (
            <span>
              New badge{summary.badges.length === 1 ? '' : 's'}:{' '}
              {summary.badges.map((k) => badgeByKey(k)?.name ?? k).join(', ')}
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
}
