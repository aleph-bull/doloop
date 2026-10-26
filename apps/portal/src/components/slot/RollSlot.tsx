import { ROLL_BATCHES, rollOdds, rollTierInfo, type RollBatch } from '@komogon/core';
import { X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { fireConfetti } from '@komogon/ui';
import { announceAchievements } from '../../lib/achievements';
import { api, type RollResult } from '../../lib/api';
import { fxLevel, rollClass, tierStyle } from '../../lib/rolls';
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

/** The owner's sounds (2026-10-25): a pop for the smaller wins, a fanfare for the rare ones. */
const POP = 'sounds/roll-pop.mp3';
const SUCCESS = 'sounds/roll-success.mp3';
/** From this rarity (1/256) a win gets the fanfare instead of the pop. */
const SUCCESS_FROM = 8;

/**
 * How often each rarity sits on the reel, commonest first: like a real machine's strip, the
 * commonest go past again and again and the rarest only once a turn.
 */
const ON_REEL = [10, 7, 5, 4, 3, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1];
/** The reel, as tiers in order: each rarity's copies spread evenly, each one's start set apart. */
const REEL: number[] = ON_REEL.flatMap((copies, i) =>
  Array.from({ length: copies }, (_, k) => ({
    tier: i + 1,
    at: (k + ((i * 0.618034) % 1)) / copies,
  })),
)
  .sort((a, b) => a.at - b.at)
  .map((f) => f.tier);
const R = REEL.length;
/** The rows drawn: one before the first, the whole reel, and two past the end. */
const STRIP = Array.from({ length: R + 3 }, (_, k) => REEL[(k - 1 + R) % R]!);

/** The reel at full speed, in rows per ms. */
const SPEED = 0.034;
/** From the lever to the reel moving, and how long it takes to get up to speed. */
const REELS_START = 220;
const SPEED_UP = 180;
/** It spins at least this long before it starts slowing for the result. */
const MIN_SPIN = 320;
/** The machine leans in for the last stretch of a rare one. */
const TENSE_MS = 1000;
const TENSE_FROM = 6;
/** After it lands, before a new record's coins burst out. */
const BURST_DELAY = 420;

const mod = (n: number) => ((n % R) + R) % R;

/** How long the reel takes to slow down onto a rarity: rarer ones crawl longer. */
function slowingMs(tier: number): number {
  return 1150 + Math.max(0, tier - 3) * 240;
}

/** Where the reel is `ms` after it starts, getting up to speed, in rows. */
function spunBy(ms: number): number {
  if (ms <= 0) return 0;
  if (ms < SPEED_UP) return (SPEED * ms * ms) / (2 * SPEED_UP);
  return SPEED * (ms - SPEED_UP / 2);
}

/** The row a rarity rests on: its first place on the reel. */
function restFor(tier: number): number {
  return Math.max(0, REEL.indexOf(Math.max(1, tier)));
}

/** A batch's rolls, rarity by rarity, commonest first. */
function haulOf(tiers: number[]): Array<{ tier: number; n: number }> {
  const counts = new Map<number, number>();
  for (const t of tiers) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].sort((a, b) => a[0] - b[0]).map(([tier, n]) => ({ tier, n }));
}

/** Sparks thrown out of the window for a new record: more, and further, the rarer it is. */
function throwSparks(layer: HTMLElement, from: DOMRect, tier: number): void {
  const level = fxLevel(tier);
  const count = 10 + level * 8;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = `roll-spark ${rollClass(tier)}`;
    el.textContent = i % 3 === 0 ? '✧' : '✦';
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const reach = 90 + Math.random() * (80 + level * 40);
    el.style.left = `${from.left + from.width / 2}px`;
    el.style.top = `${from.top + from.height / 2}px`;
    el.style.setProperty('--dx', `${Math.cos(angle) * reach}px`);
    el.style.setProperty('--dy', `${Math.sin(angle) * reach}px`);
    el.style.setProperty('--size', `${0.8 + Math.random() * (0.6 + level * 0.25)}rem`);
    el.style.animationDelay = `${Math.random() * 160}ms`;
    layer.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }
}

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
 * The slot machine for RNG Rolls on Achievements, Jack mode's machine with one long reel:
 * pull the lever (drag it down, click, Space or Enter) for one roll, ten or a hundred, and
 * the reel spins until it crawls onto the rarest the server drew. The reel carries the
 * commonest many times and the rarest once, as a real one does. Rarer results crawl longer,
 * lean in from 1/64, and land louder: a pop for the smaller wins and the fanfare from 1/256,
 * a shake, a flash, confetti and a burst of light that grow with the rarity. Beating your
 * best is a New record: sparks fly, and coins carry it into Best at the top. A batch lays
 * out everything it drew under the reel. It stays open for the next pull; Escape, the X or
 * a click outside closes it.
 */
export function RollSlot({ cost, xp, best, volume, confetti, onRolled, onClose }: RollSlotProps) {
  const [stage, setStage] = useState<Stage>('ready');
  const [holding, setHolding] = useState(false);
  const [tense, setTense] = useState(false);
  const [batch, setBatch] = useState<RollBatch>(1);
  const [money, setMoney] = useState(xp);
  /** The best the readout shows: a new one arrives with its coins. */
  const [shownBest, setShownBest] = useState(best);
  const [shining, setShining] = useState(0);
  const [last, setLast] = useState<RollResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Counts up each landing, so the burst of light plays again. */
  const [bursts, setBursts] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const bestRef = useRef<HTMLSpanElement>(null);
  const leverRef = useRef<SlotLeverHandle>(null);
  /** The row the reel rests on: the last result. */
  const restRef = useRef(restFor(best));
  /** Ends whatever is still moving: the reel lands, coins vanish, the best catches up. */
  const settleRef = useRef<() => void>(() => {});
  const timers = useRef<number[]>([]);
  const latest = useRef({ volume, confetti, onRolled, onClose, money, cost, stage, batch });
  useEffect(() => {
    latest.current = { volume, confetti, onRolled, onClose, money, cost, stage, batch };
  });

  const place = (p: number) => {
    if (stripRef.current)
      stripRef.current.style.transform = `translateY(${(-0.5 - mod(p)) * 1.2}em)`;
  };
  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  useEffect(() => {
    preloadEffects([COIN_DROP, COIN_COLLECT, POP, SUCCESS]);
    place(restRef.current);
    const opener = document.activeElement as HTMLElement | null;
    cardRef.current?.focus({ preventScroll: true });
    return () => {
      settleRef.current();
      for (const t of timers.current) window.clearTimeout(t);
      opener?.focus?.({ preventScroll: true });
    };
  }, []);

  const price = cost * batch;
  const canPull = stage !== 'spin' && money >= price;

  const pull = (dy: number) => {
    const l = latest.current;
    const n = l.batch;
    if (l.stage === 'spin' || l.money < l.cost * n) return;
    settleRef.current();
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    leverRef.current?.swing(dy);
    playTick(l.volume, 0.6, 1.6);
    setError(null);
    setStage('spin');
    latest.current.stage = 'spin';
    setMoney((m) => m - l.cost * n);
    const from = restRef.current;
    let result: RollResult | null = null;
    let failed = false;
    api
      .roll(n)
      .then((r) => {
        result = r;
      })
      .catch((err: unknown) => {
        failed = true;
        setError(err instanceof Error ? err.message : 'Something went wrong');
      });

    const sound = () => latest.current.volume;
    let frame = 0;
    let t = 0;
    let prevNow = performance.now();
    /** Once the result is in: where it starts slowing, by when, and where it lands. */
    let plan: { at: number; from: number; distance: number; run: number; tier: number } | null =
      null;
    let landed = false;
    let thunk = false;
    let lastRow = Math.round(from);
    let lastTick = 0;
    let coins: Coin[] = [];
    let burstAt = Infinity;
    let pendingBest = 0;
    let landedCoins = 0;
    let done = false;

    const finishCoins = () => {
      for (const c of coins) c.el.remove();
      coins = [];
      if (pendingBest) {
        setShownBest(pendingBest);
        setShining((s) => s + 1);
      }
      pendingBest = 0;
    };
    const refund = () => {
      setStage('ready');
      latest.current.stage = 'ready';
      setMoney((m) => m + l.cost * n);
    };
    settleRef.current = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(frame);
      finishCoins();
      if (plan) {
        restRef.current = restFor(plan.tier);
        place(restRef.current);
      }
    };

    /** The reel stops on the result: the flash, the sounds and the show, louder the rarer. */
    const land = (r: RollResult) => {
      landed = true;
      // The page behind learns the result only now, so it can't give it away.
      latest.current.onRolled(r);
      setTense(false);
      setLast(r);
      setMoney(r.xp);
      setStage('result');
      latest.current.stage = 'result';
      setBursts((b) => b + 1);
      restRef.current = restFor(r.tier);
      const level = fxLevel(r.tier);
      if (r.tier >= SUCCESS_FROM) playEffect(SUCCESS, sound());
      else if (r.tier >= 3 || r.newBest) playEffect(POP, sound(), 0.85 + 0.05 * r.tier);
      if (latest.current.confetti && level >= 3) {
        const waves = level - 2;
        for (let w = 0; w < waves; w++)
          later(w * 450, () =>
            fireConfetti({ count: 50 + 30 * level, durationMs: 1600 + level * 200 }),
          );
      }
      // A batch lays out what it drew, a tick for each rarity, rising.
      const haul = haulOf(r.tiers ?? [r.tier]);
      if (haul.length > 1)
        haul.forEach((h, i) =>
          later(260 + i * 110, () => playTick(sound(), 0.9 + h.tier * 0.06, 1.1)),
        );
      if (r.fresh.length) later(1200, () => announceAchievements(r.fresh));
      if (r.newBest) {
        pendingBest = r.tier;
        burstAt = t + BURST_DELAY;
        const box = windowRef.current?.getBoundingClientRect();
        if (box && layerRef.current && !stillMotion()) throwSparks(layerRef.current, box, r.tier);
      }
    };

    const burst = (r: RollResult) => {
      const box = windowRef.current?.getBoundingClientRect();
      const layer = layerRef.current;
      if (!box || !layer) return finishCoins();
      const count = Math.min(44, 6 + 3 * r.tier);
      const gap = Math.min(80, Math.max(26, 1000 / count));
      coins = burstCoins(
        layer,
        box,
        count,
        rollOdds(r.tier),
        false,
        (i) => burstAt + BURST_MS + i * gap,
      );
      // Ringed in the rarity's colour, which they take from the layer.
      for (const c of coins) c.el.classList.add('is-roll');
      playEffect(COIN_DROP, sound(), 1.15);
    };

    /** One coin into Best: the new record shows with the first, a bump and a rising note each. */
    const coinIn = () => {
      landedCoins += 1;
      const total = landedCoins + coins.filter((c) => !c.landed).length;
      if (pendingBest) {
        setShownBest(pendingBest);
        setShining((s) => s + 1);
        pendingBest = 0;
      }
      playEffect(COIN_COLLECT, sound(), 0.95 + 0.6 * (landedCoins / total), total > 14 ? 0.5 : 0.7);
      const el = bestRef.current;
      if (el && typeof el.animate === 'function') {
        const lastOne = landedCoins === total;
        el.animate([{ transform: `scale(${lastOne ? 1.3 : 1.1})` }, { transform: 'scale(1)' }], {
          duration: lastOne ? 560 : 200,
          easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
        });
      }
      return true;
    };

    if (stillMotion()) {
      // No motion: the reel is already on the result when it comes back.
      const wait = () => {
        if (done) return;
        if (failed) {
          done = true;
          return refund();
        }
        if (!result) {
          frame = requestAnimationFrame(wait);
          return;
        }
        plan = { at: 0, from: 0, distance: 0, run: 0, tier: result.tier };
        place(restFor(result.tier));
        land(result);
        finishCoins();
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
        return refund();
      }

      // The result is in and it has spun long enough: slow down onto it. It keeps going at
      // full speed until the place where slowing down at that speed lands it on the result.
      if (!plan && result && spun >= Math.max(MIN_SPIN, SPEED_UP)) {
        const run = slowingMs(result.tier) - SETTLE_MS;
        const distance = (SPEED * run) / 4 - OVERSHOOT;
        const here = from + spunBy(spun);
        let lands = Math.ceil(here + distance);
        while (REEL[mod(lands)] !== result.tier) lands++;
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

      // A tick for each row that passes the line, higher the rarer it is.
      const row = Math.round(p);
      if (row !== lastRow && t - lastTick > 28 && !thunk) {
        lastTick = t;
        playTick(sound(), 0.8 + 0.05 * REEL[mod(row)]!, 0.7);
      }
      lastRow = row;

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
  const level = result ? fxLevel(result.tier) : 0;
  const haul = stage === 'result' && last?.tiers && last.tiers.length > 1 ? haulOf(last.tiers) : [];
  const record = stage === 'result' && !!last?.newBest;

  return createPortal(
    <div
      ref={layerRef}
      className={`jack-slot-layer roll-slot-layer is-${stage}${tense ? ' is-tense' : ''}${holding ? ' is-holding' : ''}${canPull ? ' can-pull' : ''}${result ? ` fx-${level}` : ''}`}
      style={result ? tierStyle(result.tier) : undefined}
      onClick={() => latest.current.onClose()}
    >
      {result && level >= 3 && (
        <div key={bursts} className={`roll-burst ${rollClass(result.tier)}`} aria-hidden />
      )}
      <div
        ref={cardRef}
        className={`jack-slot-card roll-slot-card glass glass-strong${result ? ` fx-${level}` : ''}${result && level >= 3 ? ' is-big' : ''}${record ? ' is-record' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="RNG Rolls"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="roll-slot-top">
          <span className="roll-slot-best">
            <span className="roll-slot-label">Best</span>
            <span
              key={shining}
              ref={bestRef}
              className={`roll-slot-best-title${shown ? ` ${rollClass(shown.tier)}` : ''}${shining ? ' is-shining' : ''}`}
            >
              {shown ? shown.title : '–'}
            </span>
            {shown && <span className="roll-slot-best-odds tabular">{rollOdds(shown.tier)}</span>}
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
        <div className="jack-slot-machine roll-slot-machine" aria-hidden>
          {record && (
            <span key={`record-${bursts}`} className="roll-record" style={tierStyle(last!.tier)}>
              <span className={rollClass(last!.tier)}>New record</span>
            </span>
          )}
          <div ref={windowRef} className="jack-slot-window roll-slot-window">
            <div className="jack-slot-reels">
              <div className="roll-reel">
                <div ref={stripRef} className="jack-reel-strip">
                  {STRIP.map((tier, i) => (
                    <span key={i} className={`roll-reel-row roll-reel-row-${tier}`}>
                      {rollOdds(tier)}
                    </span>
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
          {error ? (
            error
          ) : stage === 'spin' ? (
            ' '
          ) : result ? (
            <>
              <span className={`roll-slot-title ${rollClass(result.tier)}`}>{result.title}</span>
              <span className="roll-slot-line-odds tabular">{rollOdds(result.tier)}</span>
            </>
          ) : money < price ? (
            'Not enough XP'
          ) : (
            'Pull the lever'
          )}
        </div>
        {haul.length > 0 && (
          <ol key={`haul-${bursts}`} className="roll-haul" aria-label="This pull">
            {haul.map((h, i) => (
              <li
                key={h.tier}
                className="roll-haul-chip"
                style={{ ...tierStyle(h.tier), '--i': i } as CSSProperties}
              >
                <span className={`tabular ${rollClass(h.tier)}`}>{rollOdds(h.tier)}</span>
                <span className="roll-haul-n tabular">×{h.n}</span>
              </li>
            ))}
          </ol>
        )}
        <div className="roll-slot-foot">
          <div className="roll-batch" role="group" aria-label="Rolls a pull">
            {ROLL_BATCHES.map((n) => (
              <button
                key={n}
                type="button"
                className="roll-batch-btn tabular"
                aria-pressed={batch === n}
                disabled={stage === 'spin'}
                onClick={() => setBatch(n)}
              >
                ×{n}
              </button>
            ))}
          </div>
          <span className="roll-slot-price tabular">{price.toLocaleString()} XP</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
