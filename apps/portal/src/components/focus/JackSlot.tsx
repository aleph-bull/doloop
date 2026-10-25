import { formatClock, JACK_FACES, type JackRoll } from '@komogon/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmtMinutes } from '../../lib/format';
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
} from '../slot/slot-kit';
import { SlotLever, type SlotLeverHandle } from '../slot/SlotLever';

/** The owner's voice line, played when the lever hasn't been pulled after NUDGE_MS. */
const GO_BACK = 'sounds/go-back-to-focus.mp3';
const NUDGE_MS = 7000;
/** The voice line 3 dB over the other sounds (owner, 2026-10-25): 10^(3/20). */
const GO_BACK_LEVEL = 1.413;

/** Decode the machine's sounds ahead of the first spin, so they play on time. */
export function preloadJackSounds(): void {
  preloadEffects([COIN_DROP, COIN_COLLECT, GO_BACK]);
}

/** The two reels: whole breaks, then tenths. */
const WHOLE = [0, 1, 2, 3];
const TENTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** The show, in ms from the lever. */
const REELS_START = 220;
const WHOLE_STOPS = 1500;
const TENTHS_STOPS = 2900;
/** The last stretch of the tenths reel, when the machine leans in. */
const TENSE_MS = 1100;
/** The result alone, then the break it gives, then the burst. */
const RESULT_HOLD = 750;
const TIME_HOLD = 850;
/** After the last coin lands, before it all goes away. */
const OUTRO_MS = 750;
/** Without motion, how long the result stays. */
const STILL_STAY_MS = 3200;

/** "5 min", "2 min 30 s", "1 h". */
function fmtBreak(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const rest = seconds % 60;
  const min = Math.floor(seconds / 60);
  if (rest === 0) return fmtMinutes(min);
  return min === 0 ? `${rest} s` : `${min} min ${rest} s`;
}

function resultLine(roll: JackRoll): string {
  if (roll.breakMs === 0) return 'No break';
  if (roll.breakMs === roll.baseMs) return `Break ${fmtBreak(roll.baseMs)}`;
  return `Break ${fmtBreak(roll.baseMs)} → ${fmtBreak(roll.breakMs)}`;
}

/** Round steps a coin can carry, in seconds. */
const STEPS = [1, 2, 3, 5, 6, 10, 12, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 600];

/**
 * How many coins the break breaks into, and what each one carries: more coins for a bigger
 * win, each a round amount when one fits.
 */
function coinsFor(seconds: number, multiplier: number): { count: number; step: number } {
  const want = Math.min(36, Math.max(8, Math.round(8 + 9 * multiplier)));
  let best: { count: number; step: number } | null = null;
  for (const step of STEPS) {
    if (seconds % step !== 0) continue;
    const count = seconds / step;
    if (count < 6 || count > 40) continue;
    if (!best || Math.abs(count - want) < Math.abs(best.count - want)) best = { count, step };
  }
  return best ?? { count: want, step: seconds / want };
}

/**
 * A reel's strip: the numbers it runs through, from one above `from` (where it rests before
 * the pull) to one past where it lands on `value`. It travels `length - 3` numbers.
 */
function strip(values: number[], from: number, value: number, spins: number): number[] {
  const n = values.length;
  const start = values.indexOf(from);
  const end = n * (spins + 1) + ((values.indexOf(value) - start + n) % n);
  return Array.from({ length: end + 3 }, (_, k) => values[(start + k - 1 + n) % n]!);
}

/** The visible break clock: the focus screen's or the dashboard card's. */
function findTarget(): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>('[data-jack-target]')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight) return el;
  }
  return null;
}

/** A reel's place at `t` ms: fast at first, slowing to a crawl, a touch past, then back. */
function reelAt(t: number, start: number, stop: number, distance: number): number {
  if (t <= start) return 0;
  const run = stop - start - SETTLE_MS;
  if (t < start + run) return (distance + OVERSHOOT) * easeOutQuart((t - start) / run);
  const u = Math.min(1, (t - start - run) / SETTLE_MS);
  return distance + OVERSHOOT * (1 - easeOutCubic(u));
}

type Stage = 'ready' | 'spin' | 'result' | 'time' | 'burst';

export interface JackSlotProps {
  roll: JackRoll;
  /** The timer is still waiting for the lever; if that ends elsewhere, an unpulled machine goes. */
  waiting: boolean;
  /** 0..1, or 0 for no sound. */
  volume: number;
  /** Seconds left in the break right now, or null once the break is over. */
  remaining: () => number | null;
  /** What the break clock shows while the coins go in; null hands it back. */
  onCount: (seconds: number | null) => void;
  onDone: () => void;
}

/**
 * Jack mode's slot machine: when a work interval ends it waits for its lever, pulled by
 * dragging it down (or a click, Space or Enter); after seven seconds without a pull it says
 * so out loud. The reels spin and land on the multiplier the timer already used to set the
 * break. The result turns into the break it gives, which bursts into coins that fly into the
 * break clock, counting it up from 0:00 as each lands (or into the machine's own clock when
 * the timer isn't on screen). 0x drops its coins instead. Once pulled, a click or Escape puts
 * it away; Escape before the pull skips the show.
 */
export function JackSlot({ roll, waiting, volume, remaining, onCount, onDone }: JackSlotProps) {
  const face = JACK_FACES[roll.face] ?? JACK_FACES[10]!;
  const tenths = roll.face;
  const bust = roll.breakMs === 0;
  const [stage, setStage] = useState<Stage>('ready');
  /** The card is taken out once it has shrunk away, so its glass leaves nothing behind. */
  const [cardGone, setCardGone] = useState(false);
  /** The lever is being held. */
  const [holding, setHolding] = useState(false);
  /** True when the coins come back into the machine, the timer not being on screen. */
  const [ownClock, setOwnClock] = useState(false);
  const [tense, setTense] = useState(false);
  const [clock, setClock] = useState<number | null>(null);
  const wholeRef = useRef<HTMLDivElement>(null);
  const tenthsRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const leverRef = useRef<SlotLeverHandle>(null);
  /** Set by the show once it is ready: pulls the lever from `dy` px down. */
  const pullRef = useRef<((dy: number) => void) | null>(null);
  const finishRef = useRef<(() => void) | null>(null);
  const latest = useRef({ remaining, onCount, onDone, volume });
  useEffect(() => {
    latest.current = { remaining, onCount, onDone, volume };
  });

  // At rest the machine shows 1.0x, the usual break.
  const wholeStrip = useMemo(() => strip(WHOLE, 1, Math.floor(tenths / 10), 3), [tenths]);
  const tenthsStrip = useMemo(() => strip(TENTHS, 0, tenths % 10, 5), [tenths]);

  // Let go elsewhere (resumed from another tab, say) before the pull: nothing left to show.
  useEffect(() => {
    if (!waiting && stage === 'ready') finishRef.current?.();
  }, [waiting, stage]);

  useEffect(() => {
    const l = latest.current;
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      latest.current.onCount(null);
      latest.current.onDone();
    };
    finishRef.current = finish;
    let started = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (!started && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        pullRef.current?.(0);
      }
    };
    window.addEventListener('keydown', onKey);
    // The clock waits at 0:00 until the coins come in.
    l.onCount(0);
    // Seven seconds without a pull: the owner's voice line, once.
    const nudge = window.setTimeout(() => {
      if (!started && !closed) playEffect(GO_BACK, latest.current.volume, 1, GO_BACK_LEVEL);
    }, NUDGE_MS);

    if (stillMotion()) {
      // Straight to the result: the reels already on it, the clock as it is.
      let id = 0;
      pullRef.current = () => {
        if (started) return;
        started = true;
        for (const [ref, s] of [
          [wholeRef, wholeStrip],
          [tenthsRef, tenthsStrip],
        ] as const) {
          if (ref.current)
            ref.current.style.transform = `translateY(${(-0.5 - (s.length - 3)) * 1.2}em)`;
        }
        latest.current.onCount(null);
        setStage('result');
        if (!bust) playEffect(COIN_COLLECT, latest.current.volume);
        id = window.setTimeout(finish, STILL_STAY_MS);
      };
      return () => {
        window.clearTimeout(id);
        window.clearTimeout(nudge);
        window.removeEventListener('keydown', onKey);
      };
    }

    const sound = () => latest.current.volume;
    const wholeDistance = wholeStrip.length - 3;
    const tenthsDistance = tenthsStrip.length - 3;
    const reels = [
      { el: wholeRef, stop: WHOLE_STOPS, distance: wholeDistance, last: 0, tick: 0, pitch: 0.85 },
      { el: tenthsRef, stop: TENTHS_STOPS, distance: tenthsDistance, last: 0, tick: 0, pitch: 1.1 },
    ];
    const landedAt = TENTHS_STOPS;
    const timeAt = landedAt + RESULT_HOLD;
    const burstAt = timeAt + TIME_HOLD;

    let t = 0;
    let prev = performance.now();
    let frame = 0;
    let stageNow: Stage = 'ready';
    let ownClockNow = false;
    let leaning = false;
    let coins: Coin[] = [];
    let target: HTMLElement | null = null;
    let goal = { x: 0, y: 0 };
    let landedCoins = 0;
    let shown = 0;
    let doneAt = Infinity;
    let gone = false;
    const accent =
      getComputedStyle(document.documentElement).getPropertyValue('--accent-text').trim() ||
      'currentColor';

    const enter = (next: Stage) => {
      stageNow = next;
      setStage(next);
    };

    const burst = () => {
      const from = timeRef.current?.getBoundingClientRect();
      const layer = layerRef.current;
      if (!from || !layer) return;
      const seconds = Math.round((bust ? roll.baseMs : roll.breakMs) / 1000);
      const { count, step } = coinsFor(seconds, bust ? 1 : face.multiplier);
      const label = `${bust ? '−' : '+'}${formatClock(step)}`;
      target = bust ? null : findTarget();
      if (!bust && !target) {
        ownClockNow = true;
        setOwnClock(true);
      }
      if (!bust) {
        shown = 0;
        latest.current.onCount(0);
        setClock(0);
      }
      const gap = Math.min(95, Math.max(36, 1200 / count));
      coins = burstCoins(layer, from, count, label, bust, (i) => burstAt + BURST_MS + i * gap);
      playEffect(COIN_DROP, sound());
    };

    /** One coin in: the clock steps up, a coin sound a little higher each time, a bump. */
    const land = () => {
      landedCoins += 1;
      const n = landedCoins;
      const total = coins.length;
      const left = latest.current.remaining();
      if (left === null) {
        // The break ended under the machine (skipped, say): nothing left to fill.
        finish();
        return;
      }
      shown = n === total ? left : Math.max(shown, Math.round((left * n) / total));
      latest.current.onCount(shown);
      setClock(shown);
      playEffect(COIN_COLLECT, sound(), 0.95 + 0.6 * (n / total), total > 14 ? 0.5 : 0.7);
      const el = target ?? timeRef.current;
      if (el && typeof el.animate === 'function') {
        const last = n === total;
        el.animate(
          [{ transform: `scale(${last ? 1.22 : 1.09})`, color: accent }, { transform: 'scale(1)' }],
          { duration: last ? 520 : 200, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
        );
      }
      if (n === total) doneAt = t + OUTRO_MS;
    };

    const step = (now: number) => {
      // A hidden tab stops frames; the show waits for it rather than jumping ahead.
      const dt = Math.min(50, now - prev);
      prev = now;
      t += dt;

      for (const reel of reels) {
        const p = reelAt(t, REELS_START, reel.stop, reel.distance);
        const el = reel.el.current;
        if (el) el.style.transform = `translateY(${(-0.5 - p) * 1.2}em)`;
        const at = Math.round(p);
        if (at !== reel.last && t - reel.tick > 28 && t < reel.stop - SETTLE_MS) {
          reel.tick = t;
          playTick(sound(), reel.pitch, 0.7);
        }
        reel.last = at;
        // The thunk as it lands, before it settles back.
        const hits = reel.stop - SETTLE_MS;
        if (t >= hits && t - dt < hits) playTick(sound(), 0.5, 2);
      }

      if (stageNow === 'spin' && t >= landedAt - TENSE_MS && !leaning) {
        leaning = true;
        setTense(true);
      }
      if (stageNow === 'spin' && t >= landedAt) {
        setTense(false);
        enter('result');
      }
      if (stageNow === 'result' && t >= timeAt) enter('time');
      if (stageNow === 'time' && t >= burstAt) {
        enter('burst');
        burst();
        if (!coins.length) doneAt = t + OUTRO_MS;
        else if (bust) doneAt = t + BURST_MS + 900;
      }
      // Once the card has shrunk away it goes from the page.
      if (stageNow === 'burst' && !ownClockNow && t >= burstAt + 300 && !gone) {
        gone = true;
        setCardGone(true);
      }

      if (coins.length) {
        if (target?.isConnected) goal = textCentre(target);
        else if (timeRef.current) {
          const r = timeRef.current.getBoundingClientRect();
          goal = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        const going = stepCoins(coins, t, dt, burstAt, goal, bust, () => {
          land();
          return !closed;
        });
        if (!going) return;
      }

      if (t >= doneAt) {
        finish();
        return;
      }
      frame = requestAnimationFrame(step);
    };

    /** The lever comes down from where the hand left it, swings back up, and the reels go. */
    pullRef.current = (dy: number) => {
      if (started) return;
      started = true;
      window.clearTimeout(nudge);
      leverRef.current?.swing(dy);
      playTick(sound(), 0.6, 1.6);
      enter('spin');
      prev = performance.now();
      frame = requestAnimationFrame(step);
    };
    return () => {
      window.clearTimeout(nudge);
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
      for (const c of coins) c.el.remove();
    };
  }, [
    roll.cycle,
    roll.at,
    roll.baseMs,
    roll.breakMs,
    bust,
    face.multiplier,
    wholeStrip,
    tenthsStrip,
  ]);

  const tone = bust ? ' is-bust' : tenths > 10 ? ' is-won' : tenths < 10 ? ' is-lost' : '';
  const big = tenths >= 20 ? ' is-big' : '';
  const showTime = stage === 'time' || stage === 'burst';
  // Once it bursts the time is in the coins: gone, or counting back up in the machine.
  const timeText =
    stage !== 'burst'
      ? formatClock((bust ? roll.baseMs : roll.breakMs) / 1000)
      : ownClock && clock !== null
        ? formatClock(clock)
        : '';

  return createPortal(
    <div
      ref={layerRef}
      className={`jack-slot-layer is-${stage}${ownClock ? ' is-own-clock' : ''}${tense ? ' is-tense' : ''}${holding ? ' is-holding' : ''}`}
      onClick={() => {
        if (stage !== 'ready') finishRef.current?.();
      }}
    >
      {!cardGone && (
        <div
          className={`jack-slot-card glass glass-strong${tone}${big}`}
          role="dialog"
          aria-modal="true"
          aria-label="Slot machine"
        >
          <div className="jack-slot-machine" aria-hidden>
            <div className={`jack-slot-window${showTime ? ' is-time' : ''}`}>
              <div className="jack-slot-reels">
                <div className="jack-reel">
                  <div ref={wholeRef} className="jack-reel-strip">
                    {wholeStrip.map((v, i) => (
                      <span key={i}>{v}</span>
                    ))}
                  </div>
                </div>
                <span className="jack-slot-dot">.</span>
                <div className="jack-reel">
                  <div ref={tenthsRef} className="jack-reel-strip">
                    {tenthsStrip.map((v, i) => (
                      <span key={i}>{v}</span>
                    ))}
                  </div>
                </div>
                <span className="jack-slot-x">×</span>
              </div>
              <div
                ref={timeRef}
                className={`jack-slot-time tabular${timeText.length > 5 ? ' is-long' : ''}`}
              >
                {timeText}
              </div>
            </div>
            <SlotLever
              ref={leverRef}
              ready={stage === 'ready'}
              volume={volume}
              onHolding={setHolding}
              onPull={(dy) => pullRef.current?.(dy)}
            />
          </div>
          <div className="jack-slot-line tabular" aria-live="polite">
            {stage === 'ready' ? 'Pull the lever' : stage === 'spin' ? ' ' : resultLine(roll)}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
