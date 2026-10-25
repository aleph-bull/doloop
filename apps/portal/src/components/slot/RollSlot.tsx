import { ROLL_NAME_TIER, ROLL_TIERS, rollOdds, rollTierInfo } from '@komogon/core';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fireConfetti } from '@komogon/ui';
import { announceAchievements } from '../../lib/achievements';
import { api, type RollResult } from '../../lib/api';
import { tierStyle } from '../../lib/rolls';
import { playEffect, playTick, preloadEffects } from '../../lib/sounds';
import {
  BURST_MS,
  burstCoins,
  COIN_COLLECT,
  COIN_DROP,
  easeOutCubic,
  easeOutQuart,
  OVERSHOOT,
  SETTLE_MS,
  stepCoins,
  stillMotion,
  textCentre,
  type Coin,
} from './slot-kit';
import { SlotLever, type SlotLeverHandle } from './SlotLever';

const N = ROLL_TIERS.length;
/** The reel at full speed, in rarities per ms. */
const SPEED = 0.032;
/** From the lever to the reel moving, and how long it takes to get up to speed. */
const REELS_START = 220;
const SPEED_UP = 180;
/** It spins at least this long before it starts slowing for the result. */
const MIN_SPIN = 320;
/** The machine leans in for the last stretch of a rare one. */
const TENSE_MS = 1000;
const TENSE_FROM = 6;
/** After it lands, before a new best's coins burst out. */
const BURST_DELAY = 260;

/** How long the reel takes to slow down onto a rarity: rarer ones crawl longer. */
function slowingMs(tier: number): number {
  return 1150 + Math.max(0, tier - 3) * 240;
}

/** Where the reel is `ms` after it starts, getting up to speed, in rarities. */
function spunBy(ms: number): number {
  if (ms <= 0) return 0;
  if (ms < SPEED_UP) return (SPEED * ms * ms) / (2 * SPEED_UP);
  return SPEED * (ms - SPEED_UP / 2);
}

/** The reel's rows: one before the first rarity, every rarity, and two past the last. */
const STRIP = Array.from({ length: N + 3 }, (_, k) => ROLL_TIERS[(k - 1 + N) % N]!);

type Stage = 'ready' | 'spin' | 'result';

export interface RollSlotProps {
  cost: number;
  xp: number;
  /** The rarest roll so far, as its tier; 0 for none. */
  best: number;
  /** 0..1, or 0 for no sound. */
  volume: number;
  confetti: boolean;
  onRolled: (result: RollResult) => void;
  onClose: () => void;
}

/**
 * The slot machine for rolls on Achievements, Jack mode's machine with one long reel: pull
 * the lever (drag it down, click, Space or Enter) and 10 XP spins it through every rarity,
 * 1/2 up to 1/8192, until it crawls onto the one the server drew. Rarer results crawl
 * longer, and from 1/64 the machine leans in. A new best bursts into coins that fly into
 * Best at the top; from 1/256 the card shakes and throws confetti. It stays open for the
 * next pull; Escape, the X or a click outside closes it.
 */
export function RollSlot({ cost, xp, best, volume, confetti, onRolled, onClose }: RollSlotProps) {
  const [stage, setStage] = useState<Stage>('ready');
  const [holding, setHolding] = useState(false);
  const [tense, setTense] = useState(false);
  const [money, setMoney] = useState(xp);
  /** The best the readout shows: a new one arrives with its coins. */
  const [shownBest, setShownBest] = useState(best);
  const [last, setLast] = useState<RollResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const bestRef = useRef<HTMLSpanElement>(null);
  const leverRef = useRef<SlotLeverHandle>(null);
  /** Where the reel rests, in rarities from 1/2: on the last result. */
  const restRef = useRef(Math.max(0, best - 1));
  /** Ends whatever is still moving: the reel lands, coins vanish, the best catches up. */
  const settleRef = useRef<() => void>(() => {});
  const latest = useRef({ volume, confetti, onRolled, onClose, money, cost, stage });
  useEffect(() => {
    latest.current = { volume, confetti, onRolled, onClose, money, cost, stage };
  });

  const place = (p: number) => {
    const at = ((p % N) + N) % N;
    if (stripRef.current) stripRef.current.style.transform = `translateY(${(-0.5 - at) * 1.2}em)`;
  };

  useEffect(() => {
    preloadEffects([COIN_DROP, COIN_COLLECT]);
    place(restRef.current);
    const opener = document.activeElement as HTMLElement | null;
    cardRef.current?.focus({ preventScroll: true });
    return () => {
      settleRef.current();
      opener?.focus?.({ preventScroll: true });
    };
  }, []);

  const canPull = stage !== 'spin' && money >= cost;

  const pull = (dy: number) => {
    const l = latest.current;
    if (l.stage === 'spin' || l.money < l.cost) return;
    settleRef.current();
    leverRef.current?.swing(dy);
    playTick(l.volume, 0.6, 1.6);
    setError(null);
    setStage('spin');
    latest.current.stage = 'spin';
    setMoney((m) => m - l.cost);
    const from = restRef.current;
    let result: RollResult | null = null;
    let failed = false;
    api
      .roll()
      .then((r) => {
        result = r;
      })
      .catch((err: unknown) => {
        failed = true;
        setError(err instanceof Error ? err.message : 'Something went wrong');
      });

    const still = stillMotion();
    const sound = () => latest.current.volume;
    let frame = 0;
    let t = 0;
    let prevNow = performance.now();
    /** Once the result is in: where it starts slowing, by when, and where it lands. */
    let plan: { at: number; from: number; distance: number; run: number; tier: number } | null =
      null;
    let landed = false;
    let thunk = false;
    let lastFace = Math.round(from);
    let lastTick = 0;
    let coins: Coin[] = [];
    let burstAt = Infinity;
    let pendingBest = 0;
    let landedCoins = 0;
    let done = false;

    const finishCoins = () => {
      for (const c of coins) c.el.remove();
      coins = [];
      if (pendingBest) setShownBest(pendingBest);
      pendingBest = 0;
    };
    settleRef.current = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(frame);
      finishCoins();
      if (plan) {
        restRef.current = plan.tier - 1;
        place(restRef.current);
      }
    };

    /** The reel stops on the result: the flash, the sounds, and for a new best, the coins. */
    const land = (r: RollResult) => {
      landed = true;
      // The page behind learns the result only now, so it can't give it away.
      latest.current.onRolled(r);
      setTense(false);
      setLast(r);
      setMoney(r.xp);
      setStage('result');
      latest.current.stage = 'result';
      restRef.current = r.tier - 1;
      const rare = r.tier >= ROLL_NAME_TIER;
      if (rare) {
        playEffect(COIN_DROP, sound());
        if (latest.current.confetti) fireConfetti({ count: 60 + 12 * r.tier, durationMs: 1800 });
      }
      if (r.tier >= 4) playEffect(COIN_COLLECT, sound(), 0.85 + 0.05 * r.tier);
      if (r.fresh.length) window.setTimeout(() => announceAchievements(r.fresh), 900);
      if (r.newBest) {
        pendingBest = r.tier;
        burstAt = t + BURST_DELAY;
      }
    };

    const burst = (r: RollResult) => {
      const box = windowRef.current?.getBoundingClientRect();
      const layer = layerRef.current;
      if (!box || !layer) return finishCoins();
      const count = Math.min(30, 6 + 2 * r.tier);
      const gap = Math.min(80, Math.max(30, 900 / count));
      coins = burstCoins(
        layer,
        box,
        count,
        rollOdds(r.tier),
        false,
        (i) => burstAt + BURST_MS + i * gap,
      );
      playEffect(COIN_DROP, sound(), 1.15);
    };

    /** One coin into Best: the new best shows with the first, a bump and a rising note each. */
    const coinIn = () => {
      landedCoins += 1;
      const total = landedCoins + coins.filter((c) => !c.landed).length;
      if (pendingBest) {
        setShownBest(pendingBest);
        pendingBest = 0;
      }
      playEffect(COIN_COLLECT, sound(), 0.95 + 0.6 * (landedCoins / total), total > 14 ? 0.5 : 0.7);
      const el = bestRef.current;
      if (el && typeof el.animate === 'function') {
        const lastOne = landedCoins === total;
        el.animate([{ transform: `scale(${lastOne ? 1.22 : 1.09})` }, { transform: 'scale(1)' }], {
          duration: lastOne ? 520 : 200,
          easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
        });
      }
      return true;
    };

    if (still) {
      // No motion: the reel is already on the result when it comes back.
      const wait = () => {
        if (done) return;
        if (failed) {
          done = true;
          setStage('ready');
          latest.current.stage = 'ready';
          setMoney((m) => m + cost);
          return;
        }
        if (!result) {
          frame = requestAnimationFrame(wait);
          return;
        }
        plan = { at: 0, from: 0, distance: 0, run: 0, tier: result.tier };
        place(result.tier - 1);
        land(result);
        if (pendingBest) setShownBest(pendingBest);
        pendingBest = 0;
        done = true;
      };
      frame = requestAnimationFrame(wait);
      return;
    }

    const step = (now: number) => {
      if (done) return;
      // A hidden tab stops frames; the show waits for it rather than jumping ahead.
      const dt = Math.min(50, now - prevNow);
      prevNow = now;
      t += dt;
      const spun = t - REELS_START;

      if (failed && !plan) {
        // No roll after all: back where it was, nothing spent.
        done = true;
        place(from);
        setStage('ready');
        latest.current.stage = 'ready';
        setMoney((m) => m + cost);
        return;
      }

      // The result is in and it has spun long enough: slow down onto it. It keeps going at
      // full speed until the place where slowing down at that speed lands it on the result.
      if (!plan && result && spun >= Math.max(MIN_SPIN, SPEED_UP)) {
        const run = slowingMs(result.tier) - SETTLE_MS;
        const distance = (SPEED * run) / 4 - OVERSHOOT;
        const here = from + spunBy(spun);
        const target = result.tier - 1;
        const lands = target + N * Math.ceil((here + distance - target) / N);
        const at = REELS_START + (lands - distance - from) / SPEED + SPEED_UP / 2;
        plan = { at, from: lands - distance, distance, run, tier: result.tier };
      }

      let p: number;
      if (plan && t >= plan.at) {
        const u = t - plan.at;
        if (u < plan.run) p = plan.from + (plan.distance + OVERSHOOT) * easeOutQuart(u / plan.run);
        else {
          const k = Math.min(1, (u - plan.run) / SETTLE_MS);
          p = plan.from + plan.distance + OVERSHOOT * (1 - easeOutCubic(k));
          if (!thunk) {
            // The thunk as it lands, before it settles back.
            thunk = true;
            playTick(sound(), 0.5, 2);
          }
          if (k >= 1 && !landed && result) land(result);
        }
        if (!landed && plan.tier >= TENSE_FROM && u >= plan.run - TENSE_MS) setTense(true);
      } else p = from + spunBy(spun);
      place(p);

      // A tick for each rarity that passes the line, higher the rarer it is.
      const face = Math.round(p);
      if (face !== lastFace && t - lastTick > 28 && !thunk) {
        lastTick = t;
        const tier = (((face % N) + N) % N) + 1;
        playTick(sound(), 0.8 + 0.05 * tier, 0.7);
      }
      lastFace = face;

      if (landed && result) {
        if (t >= burstAt && !coins.length && pendingBest) {
          burst(result);
          burstAt = t;
        }
        if (coins.length) {
          const goal = bestRef.current ? textCentre(bestRef.current) : { x: 0, y: 0 };
          stepCoins(coins, t, dt, burstAt, goal, false, coinIn);
          if (coins.every((c) => c.landed)) {
            coins = [];
            done = true;
            return;
          }
        } else if (!pendingBest) {
          done = true;
          return;
        }
      }
      frame = requestAnimationFrame(step);
    };
    prevNow = performance.now();
    frame = requestAnimationFrame(step);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') latest.current.onClose();
      else if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
        e.preventDefault();
        pull(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // `pull` reads everything it needs from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = rollTierInfo(shownBest);
  const result = stage === 'result' && last ? rollTierInfo(last.tier) : null;
  const rare = !!result && result.tier >= ROLL_NAME_TIER;
  const tone = !result ? '' : rare ? ' is-rare is-big' : result.tier >= 4 ? ' is-won' : '';
  const line = error
    ? error
    : stage === 'spin'
      ? ' '
      : result
        ? `${result.title}${last?.newBest ? ' · New best' : ''}`
        : money < cost
          ? 'Not enough XP'
          : `Pull the lever · ${cost} XP`;

  return createPortal(
    <div
      ref={layerRef}
      className={`jack-slot-layer roll-slot-layer is-${stage}${tense ? ' is-tense' : ''}${holding ? ' is-holding' : ''}${canPull ? ' can-pull' : ''}`}
      onClick={() => latest.current.onClose()}
    >
      <div
        ref={cardRef}
        className={`jack-slot-card roll-slot-card glass glass-strong${tone}`}
        style={result ? tierStyle(result.tier) : undefined}
        role="dialog"
        aria-modal="true"
        aria-label="Roll"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="roll-slot-top">
          <span className="roll-slot-best">
            <span className="roll-slot-label">Best</span>
            <span
              ref={bestRef}
              className="roll-slot-best-odds tabular"
              style={tierStyle(shownBest)}
            >
              {shown ? rollOdds(shown.tier) : '–'}
            </span>
            {shown && <span className="roll-slot-best-title">{shown.title}</span>}
          </span>
          <span className="roll-slot-xp tabular">{money.toLocaleString()} XP</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm roll-slot-close"
            aria-label="Close"
            onClick={() => latest.current.onClose()}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="jack-slot-machine" aria-hidden>
          <div ref={windowRef} className="jack-slot-window roll-slot-window">
            <div className="jack-slot-reels">
              <div className="roll-reel">
                <div ref={stripRef} className="jack-reel-strip">
                  {STRIP.map((tier, i) => (
                    <span key={i}>{rollOdds(tier.tier)}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <SlotLever
            ref={leverRef}
            ready={canPull}
            volume={volume}
            onHolding={setHolding}
            onPull={pull}
          />
        </div>
        <div className="jack-slot-line roll-slot-line" aria-live="polite">
          {line}
        </div>
      </div>
    </div>,
    document.body,
  );
}
