import { crateName } from '@komogon/core';
import { Button, cn, useToast } from '@komogon/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type CrateOffer } from '../../lib/api';
import { keys } from '../../lib/queries';
import { tierStyle } from '../../lib/rolls';
import { playEffect } from '../../lib/sounds';
import { ROLL_POP } from '../slot/slot-kit';
import { CrateArt } from './CrateArt';

type ShopData = Awaited<ReturnType<typeof api.shop>>;

/**
 * The crates rolls have offered, a row per rarity, rarest first: Take crate gives up those
 * rolls for their crates, Keep title leaves the rolls held and lets the crates go. Shown in
 * the machine after a pull, and on Achievements for any still waiting. The inventory and the
 * rolls held are written into the caches from the answer.
 */
export function CrateOffers({
  offers,
  volume,
  onSettled,
  className,
}: {
  offers: CrateOffer[];
  volume: number;
  /** The offers just settled, either way. */
  onSettled?: (ids: string[]) => void;
  className?: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const groups = [...new Set(offers.map((o) => o.tier))]
    .sort((a, b) => b - a)
    .map((tier) => ({ tier, ids: offers.filter((o) => o.tier === tier).map((o) => o.id) }));

  const choose = async (tier: number, ids: string[], choice: 'crate' | 'title') => {
    setBusy(tier);
    try {
      const r = await api.chooseCrates(ids, choice);
      qc.setQueryData(keys.inventory, r.inventory);
      qc.setQueryData<ShopData>(keys.shop, (shop) =>
        shop?.rolls ? { ...shop, rolls: { ...shop.rolls, counts: r.held } } : shop,
      );
      if (r.taken.length) playEffect(ROLL_POP, volume, 0.85 + 0.05 * tier);
      onSettled?.(ids);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  if (!groups.length) return null;
  return (
    <ul className={cn('crate-offers', className)} aria-label="Crates">
      {groups.map((g) => (
        <li key={g.tier} className="crate-offer" style={tierStyle(g.tier)}>
          <CrateArt tier={g.tier} className="crate-offer-art" />
          <span className="crate-offer-name">
            {crateName(g.tier)}
            {g.ids.length > 1 && <span className="crate-offer-n tabular"> ×{g.ids.length}</span>}
          </span>
          <span className="crate-offer-actions">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => void choose(g.tier, g.ids, 'title')}
            >
              Keep title
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={busy === g.tier}
              disabled={busy !== null && busy !== g.tier}
              onClick={() => void choose(g.tier, g.ids, 'crate')}
            >
              Take crate
            </Button>
          </span>
        </li>
      ))}
    </ul>
  );
}
