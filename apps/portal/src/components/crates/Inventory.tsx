import {
  crateName,
  crateOdds,
  PET_RARITY_NAMES,
  petInfo,
  petRarityRank,
  PETS,
  petsOf,
  rollOdds,
  type CrateDrop,
} from '@komogon/core';
import { Panel, useToast } from '@komogon/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { existLine, pct, rarityStyle } from '../../lib/crates';
import { keys, useInventory } from '../../lib/queries';
import { tierStyle } from '../../lib/rolls';
import { preloadEffects } from '../../lib/sounds';
import { CrateArt } from './CrateArt';
import { CrateOffers } from './CrateOffers';
import { CRATE_SOUNDS, CrateOpening, type Opened } from './CrateOpening';
import { HoverCard } from './HoverCard';
import { PetSprite } from './PetSprite';

/**
 * Achievements › Inventory (owner, 2026-10-29): crates first, then pets, each rarest first,
 * with the crates still waiting for a choice above them. Hovering a crate shows what it can
 * give and how often; hovering anything shows how many exist. Clicking a crate opens one.
 * Pets do nothing yet (owner).
 */
export function Inventory({
  rolled,
  volume,
  confetti,
}: {
  /** Whether they have rolled: before that, an empty inventory isn't shown. */
  rolled: boolean;
  volume: number;
  confetti: boolean;
}) {
  const inv = useInventory();
  const qc = useQueryClient();
  const { toast } = useToast();
  /** The crate being opened: its rarity, the call, and a key per opening. */
  const [opening, setOpening] = useState<{
    tier: number;
    call: Promise<Opened>;
    n: number;
  } | null>(null);
  /** Openings so far (each dialog's key), and whether one is still waiting on the API. */
  const openings = useRef(0);
  const pending = useRef(false);

  const data = inv.data;
  const empty = !data || (!data.crates.length && !data.pets.length && !data.offers.length);
  if (!data || (empty && !rolled)) return null;
  const crates = [...data.crates].sort((a, b) => b.tier - a.tier);
  const pets = data.pets
    .flatMap((p) => {
      const info = petInfo(p.id);
      return info ? [{ ...p, info }] : [];
    })
    .sort(
      (a, b) =>
        petRarityRank(b.info.rarity) - petRarityRank(a.info.rarity) ||
        PETS.indexOf(a.info) - PETS.indexOf(b.info),
    );

  // One crate a click: a second click while the first is on its way does nothing.
  const open = (tier: number) => {
    if (pending.current) return;
    pending.current = true;
    preloadEffects(CRATE_SOUNDS);
    const call = api.openCrate(tier);
    void call.then(
      () => (pending.current = false),
      () => (pending.current = false),
    );
    openings.current += 1;
    setOpening({ tier, call, n: openings.current });
  };
  const close = () => {
    setOpening(null);
    void qc.invalidateQueries({ queryKey: keys.inventory });
    void qc.invalidateQueries({ queryKey: keys.shop });
    void qc.invalidateQueries({ queryKey: keys.me });
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby="inv-h">
      <h2 id="inv-h" className="section-title">
        Inventory
      </h2>
      <Panel className="inv-card">
        {data.offers.length > 0 && <CrateOffers offers={data.offers} volume={volume} />}
        {crates.length + pets.length === 0 ? (
          <p className="muted text-sm">Nothing yet.</p>
        ) : (
          <ul className="inv-grid">
            {crates.map((c) => (
              <li key={`crate-${c.tier}`} style={tierStyle(c.tier)}>
                <HoverCard
                  className="inv-item"
                  card={<CrateCard tier={c.tier} global={data.global[`crate:${c.tier}`] ?? 0} />}
                >
                  <button
                    type="button"
                    className="inv-tile is-crate"
                    aria-label={`Open ${crateName(c.tier)}`}
                    onClick={() => open(c.tier)}
                  >
                    <span className="inv-art">
                      <CrateArt tier={c.tier} />
                    </span>
                    <span className="inv-name">{crateName(c.tier)}</span>
                    <span className="inv-open">Open</span>
                    {c.count > 1 && <span className="inv-count tabular">×{c.count}</span>}
                  </button>
                </HoverCard>
              </li>
            ))}
            {pets.map((p) => (
              <li key={`pet-${p.id}`} style={rarityStyle(p.info.rarity)}>
                <HoverCard
                  className="inv-item"
                  card={
                    <PetCard id={p.id} count={p.count} global={data.global[`pet:${p.id}`] ?? 0} />
                  }
                >
                  <div className="inv-tile is-pet" tabIndex={0} aria-label={p.info.name}>
                    <span className="inv-art">
                      <PetSprite id={p.id} />
                    </span>
                    <span className="inv-name">{p.info.name}</span>
                    <span className="inv-rarity">{PET_RARITY_NAMES[p.info.rarity]}</span>
                    {p.count > 1 && <span className="inv-count tabular">×{p.count}</span>}
                  </div>
                </HoverCard>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {opening && (
        <CrateOpening
          key={opening.n}
          tier={opening.tier}
          call={opening.call}
          volume={volume}
          confetti={confetti}
          onError={(message) => {
            toast(message);
            close();
          }}
          onAgain={() => open(opening.tier)}
          onClose={close}
        />
      )}
    </section>
  );
}

/** One line of a crate's table, as the hover card names it. */
function dropLabel(d: CrateDrop): string {
  if (d.kind === 'xp') return `${d.xp} XP`;
  if (d.kind === 'crate') return crateName(d.tier);
  return PET_RARITY_NAMES[d.rarity];
}

/** What a crate can give, by its table: XP, pets by rarity (with the pets), and crates. */
function CrateCard({ tier, global }: { tier: number; global: number }) {
  const lines = crateOdds(tier);
  return (
    <div className="inv-hover-body" style={tierStyle(tier)}>
      <div className="inv-hover-head">
        <span className="inv-hover-title">{crateName(tier)}</span>
        <span className="inv-hover-meta tabular">{rollOdds(tier)}</span>
      </div>
      <div className="inv-hover-meta">{existLine(global)}</div>
      <ul className="inv-drops-xp">
        {lines
          .filter((l) => l.drop.kind === 'xp')
          .map((l) => (
            <li key={dropLabel(l.drop)} className="inv-drop-chip tabular">
              {dropLabel(l.drop)} <span className="inv-drop-pct">{pct(l.weight)}</span>
            </li>
          ))}
      </ul>
      <ul className="inv-drops">
        {lines
          .filter((l) => l.drop.kind !== 'xp')
          .map((l) => {
            const d = l.drop;
            return (
              <li
                key={dropLabel(d)}
                className="inv-drop"
                style={
                  d.kind === 'pet'
                    ? rarityStyle(d.rarity)
                    : tierStyle(d.kind === 'crate' ? d.tier : tier)
                }
              >
                <span className="inv-drop-label">
                  {d.kind === 'crate' && <CrateArt tier={d.tier} className="inv-drop-crate" />}
                  {dropLabel(d)}
                </span>
                <span className="inv-drop-pct tabular">{pct(l.weight)}</span>
                {d.kind === 'pet' && (
                  <span className="inv-drop-pets">
                    {petsOf(d.rarity).map((p) => (
                      <PetSprite key={p.id} id={p.id} box={[30, 22]} max={2} />
                    ))}
                  </span>
                )}
              </li>
            );
          })}
      </ul>
    </div>
  );
}

function PetCard({ id, count, global }: { id: string; count: number; global: number }) {
  const info = petInfo(id)!;
  return (
    <div className="inv-hover-body" style={rarityStyle(info.rarity)}>
      <div className="inv-hover-head">
        <span className="inv-hover-title">{info.name}</span>
        <span className="inv-hover-rarity">{PET_RARITY_NAMES[info.rarity]}</span>
      </div>
      <div className="inv-hover-meta tabular">
        {existLine(global)}
        {count > 1 && ` · You have ${count.toLocaleString()}`}
      </div>
    </div>
  );
}
