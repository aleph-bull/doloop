import { useEffect } from 'react';
import { Button, fireConfetti, Modal } from '@doloop/ui';
import { announceAchievements } from '../lib/achievements';
import type { EndSummary } from '../lib/api';
import { SessionSummary } from './SessionSummary';

export interface RewardOverlayProps {
  summary: EndSummary | null;
  onClose: () => void;
  phrasesEnabled: boolean;
  /** Kept for the call site; the banner itself reads the setting. */
  badgeToasts?: boolean;
}

/**
 * The end-of-session screen on the dashboard (spec §6, §7): confetti, the achievement
 * banner for any new badge, and the score sheet.
 */
export function RewardOverlay({ summary, onClose, phrasesEnabled }: RewardOverlayProps) {
  useEffect(() => {
    if (!summary) return;
    if (summary.confetti) fireConfetti();
    // A beat after the sheet appears, so the banner lands on top of it rather than with it.
    const id = window.setTimeout(() => announceAchievements(summary.badges), 600);
    return () => window.clearTimeout(id);
  }, [summary]);

  if (!summary) return null;
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
      <SessionSummary summary={summary} phrasesEnabled={phrasesEnabled} />
    </Modal>
  );
}
