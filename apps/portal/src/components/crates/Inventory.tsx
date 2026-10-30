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
import { Button, cn, fireConfetti, Modal, Panel, useToast } from '@komogon/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, type CrateWin, type Inventory as InventoryData } from '../../lib/api';
import { existLine, isBigPet, pct, rarityStyle } from '../../lib/crates';
import { keys, useInventory } from '../../lib/queries';
import { tierStyle } from '../../lib/rolls';
import { playEffect, preloadEffects } from '../../lib/sounds';
import { ROLL_POP, ROLL_SUCCESS } from '../slot/slot-kit';
import { CrateArt } from './CrateArt';
import { CrateOffers } from './CrateOffers';
import { HoverCard } from './HoverCard';
import { PetSprite } from './PetSprite';

type ShopData = Awaited<ReturnType<typeof api.shop>>;
type Opened = Awaited<ReturnType<typeof api.openCrate>>;

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
    preloadEffects([ROLL_POP, ROLL_SUCCESS]);
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

/** The crate shakes at least this long, then its lid comes off before what's inside shows. */
const SHAKE_MS = 1100;
const LID_MS = 380;

/**
 * Opening a crate: it shakes, its lid flies off, and what it gave rises out of it: a pet
 * walking, XP, or another crate. The rarest pets get the fanfare and confetti. The call was
 * made on the click (`call`), so it never runs twice; the caches take its answer as it shows.
 */
function CrateOpening({
  tier,
  call,
  volume,
  confetti,
  onError,
  onAgain,
  onClose,
}: {
  tier: number;
  call: Promise<Opened>;
  volume: number;
  confetti: boolean;
  onError: (message: string) => void;
  onAgain: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [stage, setStage] = useState<'shake' | 'open' | 'shown'>('shake');
  const [opened, setOpened] = useState<Opened | null>(null);
  const shownRef = useRef(false);
  const latest = useRef({ onError });
  useEffect(() => {
    latest.current = { onError };
  });

  useEffect(() => {
    let live = true;
    const timers: number[] = [];
    const at = performance.now();
    call.then(
      (r) => {
        if (!live) return;
        const wait = Math.max(0, SHAKE_MS - (performance.now() - at));
        timers.push(window.setTimeout(() => setStage('open'), wait));
        timers.push(
          window.setTimeout(() => {
            setOpened(r);
            setStage('shown');
          }, wait + LID_MS),
        );
      },
      (err: unknown) => {
        if (live) latest.current.onError(err instanceof Error ? err.message : 'Could not open it');
      },
    );
    return () => {
      live = false;
      for (const t of timers) window.clearTimeout(t);
    };
  }, [call]);

  // What it gave goes into the caches, with its sound, once.
  useEffect(() => {
    if (!opened || shownRef.current) return;
    shownRef.current = true;
    qc.setQueryData<InventoryData>(keys.inventory, opened.inventory);
    if (opened.win.kind === 'xp')
      qc.setQueryData<ShopData>(keys.shop, (s) => (s ? { ...s, xp: opened.xp } : s));
    const win = opened.win;
    const big = win.kind === 'pet' && isBigPet(petInfo(win.pet)?.rarity ?? 'common');
    if (big) {
      playEffect(ROLL_SUCCESS, volume);
      if (confetti) fireConfetti({ count: 140, durationMs: 1800 });
    } else playEffect(ROLL_POP, volume, win.kind === 'xp' ? 0.9 : 1.05);
  }, [opened, qc, volume, confetti]);

  const left = opened?.inventory.crates.find((c) => c.tier === tier)?.count ?? 0;
  return (
    <Modal
      open
      strong
      onClose={onClose}
      title={crateName(tier)}
      className="crate-open-modal"
      actions={
        stage === 'shown' ? (
          <>
            {left > 0 && (
              <Button variant="secondary" onClick={onAgain}>
                Open another
              </Button>
            )}
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="crate-open" data-stage={stage} style={tierStyle(tier)}>
        <div className="crate-open-stage">
          <CrateArt tier={tier} className="crate-open-art" />
          {opened && <Won win={opened.win} isNew={opened.isNew} />}
        </div>
      </div>
    </Modal>
  );
}

/** What came out of a crate, under the crate it came from. */
function Won({ win, isNew }: { win: CrateWin; isNew: boolean }) {
  if (win.kind === 'xp')
    return (
      <div className="crate-won">
        <span className="crate-won-xp tabular">
          +{win.xp}
          <small>XP</small>
        </span>
      </div>
    );
  if (win.kind === 'crate')
    return (
      <div className="crate-won" style={tierStyle(win.tier)}>
        <CrateArt tier={win.tier} className="crate-won-crate" />
        <span className="crate-won-name">{crateName(win.tier)}</span>
      </div>
    );
  const info = petInfo(win.pet);
  if (!info) return null;
  return (
    <div
      className={cn('crate-won', isBigPet(info.rarity) && 'is-big')}
      style={rarityStyle(info.rarity)}
    >
      <PetSprite id={win.pet} box={[200, 130]} max={6} walking />
      <span className="crate-won-name">{info.name}</span>
      <span className="crate-won-meta">
        {PET_RARITY_NAMES[info.rarity]}
        {isNew && <span className="crate-won-new">New</span>}
      </span>
    </div>
  );
}
