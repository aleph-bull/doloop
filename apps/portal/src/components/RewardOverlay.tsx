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

/**
 * Rewards + summary after a session (spec §6, §7). It leads with the time put in; the XP
 * behind the level lives on the Achievements page, not here.
 */
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
  const { workSeconds, breakSeconds, idleSeconds } = summary.session;
  const aside = [
    breakSeconds > 0 && `${fmtMinutes(breakSeconds / 60)} on break`,
    idleSeconds > 0 && `${fmtMinutes(idleSeconds / 60)} idle`,
  ].filter(Boolean);

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
        {summary.endedEarly && <p className="muted">Ended early. The minutes still count.</p>}

        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="reward-xp">
            {workSeconds > 0 && workSeconds < 30 ? '< 1 m' : fmtMinutes(workSeconds / 60)}
          </span>
          <span className="muted">focused</span>
          {summary.leveledUp && <span className="chip chip-ok">Level {summary.levelAfter}</span>}
        </div>

        <div>
          <ProgressBar value={lp.ratio} label="Progress to next level" />
          <div className="flex justify-between text-xs muted mt-1 tabular">
            <span>Level {lp.level}</span>
            <span>Level {lp.level + 1}</span>
          </div>
        </div>

        <div className="text-sm muted flex flex-col gap-1">
          {aside.length > 0 && <span>{aside.join(', ')}</span>}
          <span>
            Streak: {summary.streak.current} day{summary.streak.current === 1 ? '' : 's'}
            {summary.streak.milestonesReached.length > 0 && ' · milestone reached'}
          </span>
          {summary.streak.message && <span>{summary.streak.message}</span>}
          {summary.nodeCompleted && <span>Marked as done.</span>}
          {summary.routineTicked && <span>Ticked off.</span>}
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
