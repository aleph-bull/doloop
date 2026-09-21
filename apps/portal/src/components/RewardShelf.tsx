import type { CustomReward, RewardView } from '@doloop/core';
import { Gift, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button, Chip, Panel, Spinner, useToast } from '@doloop/ui';
import { ErrorPanel } from './ErrorState';
import { RewardDialog } from './RewardDialog';
import { RewardRedeemed } from './RewardRedeemed';
import { fmtDate } from '../lib/format';
import {
  useCreateReward,
  useDeleteReward,
  useRedeemReward,
  useRewards,
  useUpdateReward,
} from '../lib/queries';

/** One reward card: what it is, what it costs, and whether it can be taken today. */
function RewardCard({
  reward,
  xp,
  onRedeem,
  onEdit,
  onDelete,
  busy,
}: {
  reward: RewardView;
  xp: number;
  onRedeem: () => void;
  onEdit: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const short = Math.max(0, reward.costXp - xp);
  return (
    <Panel className="reward-card">
      <div className="reward-card-head">
        <span className="reward-card-glyph" aria-hidden>
          {reward.emoji ?? <Gift size={20} />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-medium">{reward.name}</div>
          {reward.note && <div className="muted text-sm">{reward.note}</div>}
        </div>
        <div className="reward-card-tools">
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={`Edit ${reward.name}`}
            onClick={onEdit}
          >
            <Pencil size={15} aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={`Delete ${reward.name}`}
            onClick={onDelete}
          >
            <Trash2 size={15} aria-hidden />
          </Button>
        </div>
      </div>
      <div className="reward-card-meta">
        <span className="tabular">{reward.costXp} XP</span>
        {reward.cooldownDays > 0 && (
          <Chip tone="neutral">
            every {reward.cooldownDays} day{reward.cooldownDays === 1 ? '' : 's'}
          </Chip>
        )}
        {reward.redeemedCount > 0 && (
          <span className="subtle text-xs tabular">taken {reward.redeemedCount}×</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {reward.availableOn ? (
          <span className="muted text-sm">Back on {fmtDate(`${reward.availableOn}T12:00:00`)}</span>
        ) : !reward.affordable ? (
          <span className="muted text-sm tabular">{short} XP to go</span>
        ) : (
          <span className="muted text-sm">Ready</span>
        )}
        <span className="flex-1" />
        <Button
          variant="primary"
          size="sm"
          disabled={!reward.redeemable}
          loading={busy}
          onClick={onRedeem}
        >
          Redeem
        </Button>
      </div>
    </Panel>
  );
}

/**
 * The user's own shop. Doloop supplies the currency and the price floor; everything on the
 * shelf is something the user decided was worth working for.
 */
export function RewardShelf() {
  const q = useRewards();
  const create = useCreateReward();
  const update = useUpdateReward();
  const remove = useDeleteReward();
  const redeemMutation = useRedeemReward();
  const { toast } = useToast();

  const [dialog, setDialog] = useState<{ open: boolean; reward: RewardView | null }>({
    open: false,
    reward: null,
  });
  const [celebrating, setCelebrating] = useState<{
    reward: CustomReward;
    xpLeft: number;
    spent: number;
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (q.isError)
    return (
      <ErrorPanel
        message={q.error instanceof Error ? q.error.message : 'Could not load your rewards.'}
        onRetry={() => q.refetch()}
      />
    );
  if (!q.data)
    return (
      <div className="flex justify-center p-8">
        <Spinner />
      </div>
    );

  const { rewards, xp, limits, history } = q.data;

  const redeem = async (reward: RewardView) => {
    setBusyId(reward.id);
    try {
      const res = await redeemMutation.mutateAsync(reward.id);
      setCelebrating({ reward: res.reward, xpLeft: res.xp, spent: res.spent });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not redeem that.');
    } finally {
      setBusyId(null);
    }
  };

  const del = async (reward: RewardView) => {
    if (!window.confirm(`Delete "${reward.name}"? Your redemption history is kept.`)) return;
    try {
      await remove.mutateAsync(reward.id);
      toast('Reward deleted', { tone: 'ok' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete that.');
    }
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby="rewards-h">
      <div className="flex items-end gap-3 flex-wrap">
        <h2 id="rewards-h" className="text-lg flex-1">
          Your rewards
        </h2>
        <Button
          size="sm"
          disabled={rewards.length >= limits.maxActive}
          onClick={() => setDialog({ open: true, reward: null })}
        >
          <Plus size={15} aria-hidden /> New reward
        </Button>
      </div>
      <p className="muted text-sm">
        Decide what the XP is for, then buy it. The lowest price is {limits.minCostXp} XP — about an
        hour of focused work — so a reward always costs something real.
      </p>

      {rewards.length === 0 ? (
        <Panel className="p-6 text-center flex flex-col items-center gap-2">
          <span aria-hidden style={{ color: 'var(--fg-subtle)' }}>
            <Gift size={28} />
          </span>
          <p className="muted">
            Nothing on the shelf yet. Add the thing you actually want — an hour of doomscrolling,
            the hoodie, a night off.
          </p>
        </Panel>
      ) : (
        <div className="card-grid">
          {rewards.map((r) => (
            <RewardCard
              key={r.id}
              reward={r}
              xp={xp}
              busy={busyId === r.id}
              onRedeem={() => void redeem(r)}
              onEdit={() => setDialog({ open: true, reward: r })}
              onDelete={() => void del(r)}
            />
          ))}
        </div>
      )}

      {history.length > 0 && (
        <details className="reward-history">
          <summary className="text-sm">Redemption history ({history.length})</summary>
          <ul className="flex flex-col gap-1 mt-2">
            {history.map((h, i) => (
              <li key={`${h.at}-${i}`} className="flex items-baseline gap-2 text-sm">
                <span aria-hidden>{h.emoji ?? '🎁'}</span>
                <span className="flex-1 min-w-0 truncate">{h.name}</span>
                <span className="muted tabular">{h.costXp} XP</span>
                <span className="subtle text-xs">{fmtDate(h.at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <RewardDialog
        // Remounting on the target keeps the form fields in sync with what is being edited.
        key={dialog.reward?.id ?? 'new'}
        open={dialog.open}
        reward={dialog.reward}
        limits={limits}
        onClose={() => setDialog({ open: false, reward: null })}
        onSave={async (input) => {
          if (dialog.reward) await update.mutateAsync({ id: dialog.reward.id, patch: input });
          else await create.mutateAsync(input);
          toast(dialog.reward ? 'Reward saved' : 'Reward added', { tone: 'ok' });
        }}
      />
      <RewardRedeemed
        reward={celebrating?.reward ?? null}
        xpLeft={celebrating?.xpLeft ?? 0}
        spent={celebrating?.spent ?? 0}
        onClose={() => setCelebrating(null)}
      />
    </section>
  );
}
