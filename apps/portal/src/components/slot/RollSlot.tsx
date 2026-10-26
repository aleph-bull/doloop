import {
  ROLL_BATCHES,
  ROLL_TICKETS,
  rollOdds,
  rollTier,
  rollTierInfo,
  type RollBatch,
} from '@komogon/core';
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
/** The owner's playing card laid down, trimmed to its snap: the click of each row going by. */
const REEL_CLICK = 'sounds/reel-card.wav';
/** From this rarity (1/256) a win gets the fanfare instead of the pop. */
const SUCCESS_FROM = 8;

/**
 * Each row of the reel is a roll of its own at the real odds (owner, 2026-10-25: "i shouldnt
 * statistically see genesis every roll"): a 1/32768 goes past about once in 32,768 rows.
 */
function drawRow(): number {
  return rollTier(Math.floor(Math.random() * ROLL_TICKETS));
}
/** Rows on show at once: the one on the line, the ones above and below, and one coming in. */
const ROWS_DRAWN = 4;

/** The reel at full speed, in rows per ms. */
const SPEED = 0.034;
/** From the lever to the reel moving, and how long it takes to get up to speed. */
const REELS_START = 220;
const SPEED_UP = 180;
/** It spins at least this long before it starts slowing for the result. */
const MIN_SPIN = 700;
/** The machine leans in for the last stretch of a rare one. */
const TENSE_MS = 1300;
const TENSE_FROM = 6;
/**
 * From 1/4096 the reel stops a row short, holds with a heartbeat, then tips over (owner: "more
 * tense especially for misses of 4096 or above"). A real one always does; and now and then an
 * ordinary roll stops on a 1/4096 or rarer that isn't, holds, and slips off it.
 */
const TEASE_FROM = 12;
const TEASE_CHANCE = 1 / 12;
/** The decoys, 1/4096 most often and 1/32768 least. */
const TEASE_WEIGHTS = [8, 4, 2, 1];
const HOLD_MS = 1300;
const HEARTBEAT_MS = 430;
const SLIP_MS = 560;
/** After it lands, before a new record's coins burst out. */
const BURST_DELAY = 420;

/** How long the reel takes to slow down onto a rarity: rarer ones crawl longer. */
function slowingMs(tier: number): number {
  return 1700 + Math.max(0, tier - 3) * 260;
}

/** A decoy for a near miss: 1/4096 most often, 1/32768 least. */
function decoyTier(): number {
  const total = TEASE_WEIGHTS.reduce((a, b) => a + b, 0);
  let ticket = Math.random() * total;
  for (let i = 0; i < TEASE_WEIGHTS.length; i++) {
    ticket -= TEASE_WEIGHTS[i]!;
    if (ticket < 0) return TEASE_FROM + i;
  }
  return TEASE_FROM;
}

const easeInOutCubic = (u: number) => (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2);

/** Where the reel is `ms` after it starts, getting up to speed, in rows. */
function spunBy(ms: number): number {
  if (ms <= 0) return 0;
  if (ms < SPEED_UP) return (SPEED * ms * ms) / (2 * SPEED_UP);
  return SPEED * (ms - SPEED_UP / 2);
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
 * the reel spins until it crawls onto the rarest the server drew. Each row on the reel is
 * drawn at the real odds, so the rare ones almost never go past. Rarer results crawl longer,
 * lean in from 1/64, from 1/4096 stop a row short and hold before tipping over (and now and
 * then a near miss does the same on a decoy and slips off it), and land louder: a pop for the smaller wins and the fanfare from 1/256,
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
  const rowEls = useRef<Array<HTMLSpanElement | null>>([]);
  /** The reel's rows by number, drawn as they come into view; row 0 starts on your best. */
  const rowsRef = useRef(new Map<number, number>([[0, Math.max(1, best)]]));
  /** The row on show at the top of the strip, so the rows are only redrawn when it moves on. */
  const shownRef = useRef<number | null>(null);
  /** The row the reel rests on: the last result. */
  const restRef = useRef(0);
  /** Ends whatever is still moving: the reel lands, coins vanish, the best catches up. */
  const settleRef = useRef<() => void>(() => {});
  const timers = useRef<number[]>([]);
  const latest = useRef({ volume, confetti, onRolled, onClose, money, cost, stage, batch });
  useEffect(() => {
    latest.current = { volume, confetti, onRolled, onClose, money, cost, stage, batch };
  });

  /** A row's rarity, drawn the first time it comes into view. */
  const rowAt = (r: number) => {
    const rows = rowsRef.current;
    let tier = rows.get(r);
    if (tier === undefined) {
      tier = drawRow();
      rows.set(r, tier);
    }
    return tier;
  };
  /** The reel at row `p`: only the few rows on show are drawn, renamed as it moves on. */
  const place = (p: number) => {
    const base = Math.floor(p);
    if (shownRef.current !== base) {
      shownRef.current = base;
      rowEls.current.forEach((el, k) => {
        if (!el) return;
        const tier = rowAt(base - 1 + k);
        el.textContent = rollOdds(tier);
        el.className = `roll-reel-row roll-reel-row-${tier}`;
      });
      for (const r of rowsRef.current.keys()) if (r < base - 4) rowsRef.current.delete(r);
    }
    if (stripRef.current)
      stripRef.current.style.transform = `translateY(${(-0.5 - (p - base)) * 1.2}em)`;
  };
  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  useEffect(() => {
    preloadEffects([COIN_DROP, COIN_COLLECT, POP, SUCCESS, REEL_CLICK]);
    place(restRef.current);
    const opener = document.activeElement as HTMLElement | null;
    cardRef.current?.focus({ preventScroll: true });
    return () => {
      settleRef.current();
      for (const t of timers.current) window.clearTimeout(t);
      opener?.focus?.({ preventScroll: true });
    };
    // Once, on opening: `place` only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    /**
     * Once the result is in: where it starts slowing and by when, the row it stops on, and
     * the row it lands on: the same, or for a hold the next one, which it tips over to.
     */
    let plan: {
      at: number;
      from: number;
      distance: number;
      run: number;
      tier: number;
      stop: number;
      lands: number;
      hold: boolean;
    } | null = null;
    let landed = false;
    let thunk = false;
    let beats = 0;
    let tipped = false;
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
        restRef.current = plan.lands;
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
      if (plan) restRef.current = plan.lands;
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
        const lands = from + 1;
        rowsRef.current.set(lands, result.tier);
        plan = {
          at: 0,
          from,
          distance: 0,
          run: 0,
          tier: result.tier,
          stop: lands,
          lands,
          hold: false,
        };
        place(lands);
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

      // The result is in and it has spun long enough: slow down onto it, from the speed it is
      // going at. A hold stops a row short (on a decoy when it is a near miss) and tips over.
      if (!plan && result && spun >= Math.max(MIN_SPIN, SPEED_UP)) {
        const real = result.tier >= TEASE_FROM;
        const decoy = !real && Math.random() < TEASE_CHANCE ? decoyTier() : 0;
        const hold = real || decoy > 0;
        const run = slowingMs(Math.max(result.tier, decoy)) - SETTLE_MS;
        const distance = (SPEED * run) / 4 - OVERSHOOT;
        const here = from + spunBy(spun);
        const stop = Math.ceil(here + distance);
        const lands = hold ? stop + 1 : stop;
        rowsRef.current.set(lands, result.tier);
        if (decoy) rowsRef.current.set(stop, decoy);
        const at = REELS_START + (stop - distance - from) / SPEED + SPEED_UP / 2;
        plan = { at, from: stop - distance, distance, run, tier: result.tier, stop, lands, hold };
      }

      let p: number;
      if (plan && t >= plan.at) {
        const u = t - plan.at;
        const stopped = plan.run + SETTLE_MS;
        if (u < plan.run) p = plan.from + (plan.distance + OVERSHOOT) * easeOutQuart(u / plan.run);
        else if (u < stopped || !plan.hold) {
          const k = Math.min(1, (u - plan.run) / SETTLE_MS);
          p = plan.stop + OVERSHOOT * (1 - easeOutCubic(k));
          if (!thunk) {
            // The thunk as it stops, before it settles back.
            thunk = true;
            playTick(sound(), 0.5, 2);
          }
          if (k >= 1 && !plan.hold && !landed && result) land(result);
        } else if (u < stopped + HOLD_MS) {
          // The hold: it creeps toward the next row, trembling, a heartbeat at a time.
          const h = u - stopped;
          p = plan.stop + 0.14 * (h / HOLD_MS) ** 2 + 0.015 * Math.sin(h / 38);
          if (h >= beats * HEARTBEAT_MS) {
            beats += 1;
            playTick(sound(), 0.32, 2.4);
            later(110, () => playTick(latest.current.volume, 0.28, 1.6));
          }
        } else {
          // It tips over onto the row below: the result.
          const v = u - stopped - HOLD_MS;
          const start = plan.stop + 0.14;
          if (v < SLIP_MS) p = start + (1 - 0.14 + OVERSHOOT) * easeInOutCubic(v / SLIP_MS);
          else {
            const k = Math.min(1, (v - SLIP_MS) / SETTLE_MS);
            p = plan.lands + OVERSHOOT * (1 - easeOutCubic(k));
            if (!tipped) {
              tipped = true;
              playTick(sound(), 0.45, 2.2);
            }
            if (k >= 1 && !landed && result) land(result);
          }
        }
        const tense = plan.tier >= TENSE_FROM || plan.hold;
        if (!landed && tense && u >= plan.run - TENSE_MS) setTense(true);
      } else p = from + spunBy(spun);
      place(p);

      // A card snapping down for each row that passes the line, a little higher the rarer it
      // is; at full speed some rows go by without one, or they would blur into a buzz.
      const row = Math.round(p);
      if (row !== lastRow && t - lastTick > 45 && !thunk) {
        lastTick = t;
        playEffect(REEL_CLICK, sound(), 0.92 + 0.035 * rowAt(row), 0.6);
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
                  {/* Filled and renamed by place() as the reel turns. */}
                  {Array.from({ length: ROWS_DRAWN }, (_, k) => (
                    <span
                      key={k}
                      ref={(el) => {
                        rowEls.current[k] = el;
                      }}
                      className="roll-reel-row"
                    />
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
              {!!last?.won && (
                <span className="roll-slot-won tabular">+{last.won.toLocaleString()} XP</span>
              )}
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
