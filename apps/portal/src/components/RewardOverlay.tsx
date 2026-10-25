import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, fireConfetti, Modal } from '@komogon/ui';
import { announceAchievements } from '../lib/achievements';
import { useSocialAfterSession } from '../lib/after-session';
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
 * banner for any new badge, and the score sheet. The sheet stays mounted after Done so the
 * modal can fade out rather than vanish.
 */
export function RewardOverlay({ summary, onClose, phrasesEnabled }: RewardOverlayProps) {
  const [shown, setShown] = useState(summary);
  useEffect(() => {
    if (summary) setShown(summary);
  }, [summary]);
  const navigate = useNavigate();
  const toSocial = useSocialAfterSession(summary?.session ?? null);
  // Closed (Done, the x or a click outside): on to Social to post it, if that's set.
  const close = () => {
    onClose();
    void toSocial().then((path) => path && navigate(path));
  };

  useEffect(() => {
    if (!summary) return;
    if (summary.confetti) fireConfetti();
    // A beat after the sheet appears, so the banner lands on top of it rather than with it.
    const id = window.setTimeout(() => announceAchievements(summary.badges), 600);
    return () => window.clearTimeout(id);
  }, [summary]);

  if (!shown) return null;
  return (
    <Modal
      open={summary !== null}
      onClose={close}
      actions={
        <Button variant="primary" onClick={close}>
          Done
        </Button>
      }
    >
      <SessionSummary summary={shown} phrasesEnabled={phrasesEnabled} onTrimmed={onClose} />
    </Modal>
  );
}
