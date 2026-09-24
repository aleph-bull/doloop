import type { CustomReward } from '@komogon/core';
import { useEffect } from 'react';
import { Button, fireConfetti, fireRewardBurst, Modal } from '@komogon/ui';

export interface RewardRedeemedProps {
  reward: CustomReward | null;
  /** XP left after the purchase, for the receipt line. */
  xpLeft: number;
  spent: number;
  onClose: () => void;
}

/**
 * The payoff for redeeming a custom reward. Loud on purpose, and different from the
 * end-of-session overlay: this is the moment the XP turns into the thing it was for.
 */
export function RewardRedeemed({ reward, xpLeft, spent, onClose }: RewardRedeemedProps) {
  useEffect(() => {
    if (!reward) return;
    const glyphs = reward.emoji ? [reward.emoji, '✨', reward.emoji, '🎉'] : undefined;
    fireRewardBurst({ glyphs });
    // A beat later, confetti underneath, so the two reads as one celebration.
    const id = window.setTimeout(() => fireConfetti({ count: 80, durationMs: 1400 }), 220);
    return () => window.clearTimeout(id);
  }, [reward]);

  if (!reward) return null;
  return (
    <Modal
      open
      onClose={onClose}
      actions={
        <Button variant="primary" onClick={onClose}>
          Go enjoy it
        </Button>
      }
    >
      <div className="reward-redeemed">
        <div className="reward-redeemed-glyph" aria-hidden>
          {reward.emoji ?? '🎁'}
        </div>
        <h2 className="text-2xl leading-tight">{reward.name}</h2>
        <p className="muted">You earned this one. Go and take it.</p>
        {reward.note && <p className="text-sm">{reward.note}</p>}
        <p className="text-sm muted tabular">
          {spent} XP spent · {xpLeft} XP left
          {reward.redeemedCount > 1 && ` · redeemed ${reward.redeemedCount} times`}
        </p>
        {reward.cooldownDays > 0 && (
          <p className="subtle text-xs">
            Back on the shelf in {reward.cooldownDays} day{reward.cooldownDays === 1 ? '' : 's'}.
          </p>
        )}
      </div>
    </Modal>
  );
}
