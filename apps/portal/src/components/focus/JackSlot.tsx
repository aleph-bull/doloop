import { formatClock, JACK_FACES, type JackRoll } from '@komogon/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmtMinutes } from '../../lib/format';
import { playEffect, playTick, preloadEffects } from '../../lib/sounds';

const COIN_DROP = 'sounds/coin-drop.mp3';
const COIN_COLLECT = 'sounds/coin-collect.mp3';

/** Decode the coins ahead of the first spin, so they land on time. */
export function preloadJackSounds(): void {
  preloadEffects([COIN_DROP, COIN_COLLECT]);
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
/** How far past the number a reel runs before it settles back, in numbers. */
const OVERSHOOT = 0.22;
const SETTLE_MS = 170;
/** The result alone, then the break it gives, then the burst. */
const RESULT_HOLD = 750;
const TIME_HOLD = 850;
/** Coins fly free before they're pulled in; each one's flight to the timer. */
const BURST_MS = 520;
const FLIGHT_MS = 400;
/** After the last coin lands, before it all goes away. */
const OUTRO_MS = 750;
/** Without motion, how long the result stays. */
const STILL_STAY_MS = 3200;

function stillMotion(): boolean {
  const motion = document.documentElement.dataset.motion;
  if (motion === 'off') return true;
  if (motion === 'on') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

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
 * A reel's strip: the numbers it runs through, from one above the first to one past where it
 * lands on `value`. It travels `length - 3` numbers.
 */
function strip(values: number[], value: number, spins: number): number[] {
  const n = values.length;
  const end = n * (spins + 1) + values.indexOf(value);
  return Array.from({ length: end + 3 }, (_, k) => values[(k - 1 + n) % n]!);
}

/** The visible break clock: the focus screen's or the dashboard card's. */
function findTarget(): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>('[data-jack-target]')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight) return el;
  }
  return null;
}

/** The middle of the digits themselves, not of the box they sit in. */
function textCentre(el: HTMLElement): { x: number; y: number } {
  const range = document.createRange();
  range.selectNodeContents(el);
  const r = range.getBoundingClientRect();
  const box = r.width > 0 ? r : el.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

const easeOutQuart = (u: number) => 1 - (1 - u) ** 4;
const easeOutCubic = (u: number) => 1 - (1 - u) ** 3;

/** A reel's place at `t` ms: fast at first, slowing to a crawl, a touch past, then back. */
function reelAt(t: number, start: number, stop: number, distance: number): number {
  if (t <= start) return 0;
  const run = stop - start - SETTLE_MS;
  if (t < start + run) return (distance + OVERSHOOT) * easeOutQuart((t - start) / run);
  const u = Math.min(1, (t - start - run) / SETTLE_MS);
  return distance + OVERSHOOT * (1 - easeOutCubic(u));
}

interface Coin {
  el: HTMLSpanElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  turn: number;
  spin: number;
  /** When it starts for the timer, ms into the show; then where it set off from. */
  leaves: number;
  from: { x: number; y: number } | null;
  bend: { x: number; y: number } | null;
  landed: boolean;
}

type Stage = 'spin' | 'result' | 'time' | 'burst';

export interface JackSlotProps {
  roll: JackRoll;
  /** 0..1, or 0 for no sound. */
  volume: number;
  /** Seconds left in the break right now, or null once the break is over. */
  remaining: () => number | null;
  /** What the break clock shows while the coins go in; null hands it back. */
  onCount: (seconds: number | null) => void;
  onDone: () => void;
}

/**
 * Jack mode's slot machine: when a work interval ends the lever pulls, the reels spin and
 * land on the multiplier the timer already used to set the break. The result turns into the
 * break it gives, which bursts into coins that fly into the break clock, counting it up from
 * 0:00 as each lands (or into the machine's own clock when the timer isn't on screen). 0x
 * drops its coins instead. A click or Escape puts it away.
 */
export function JackSlot({ roll, volume, remaining, onCount, onDone }: JackSlotProps) {
  const face = JACK_FACES[roll.face] ?? JACK_FACES[10]!;
  const tenths = roll.face;
  const bust = roll.breakMs === 0;
  const [stage, setStage] = useState<Stage>('spin');
  /** True when the coins come back into the machine, the timer not being on screen. */
  const [ownClock, setOwnClock] = useState(false);
  const [tense, setTense] = useState(false);
  const [clock, setClock] = useState<number | null>(null);
  const wholeRef = useRef<HTMLDivElement>(null);
  const tenthsRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ remaining, onCount, onDone, volume });
  useEffect(() => {
    latest.current = { remaining, onCount, onDone, volume };
  });

  const wholeStrip = useMemo(() => strip(WHOLE, Math.floor(tenths / 10), 3), [tenths]);
  const tenthsStrip = useMemo(() => strip(TENTHS, tenths % 10, 5), [tenths]);

  useEffect(() => {
    const l = latest.current;
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      latest.current.onCount(null);
      latest.current.onDone();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);

    if (stillMotion()) {
      // Straight to the result: the reels already on it, the clock as it is.
      for (const [ref, s] of [
        [wholeRef, wholeStrip],
        [tenthsRef, tenthsStrip],
      ] as const) {
        if (ref.current)
          ref.current.style.transform = `translateY(${(-0.5 - (s.length - 3)) * 1.2}em)`;
      }
      l.onCount(null);
      setStage('result');
      if (!bust) playEffect(COIN_COLLECT, l.volume);
      const id = window.setTimeout(finish, STILL_STAY_MS);
      return () => {
        window.clearTimeout(id);
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
    let stageNow: Stage = 'spin';
    let leaning = false;
    let coins: Coin[] = [];
    let target: HTMLElement | null = null;
    let goal = { x: 0, y: 0 };
    let landedCoins = 0;
    let shown = 0;
    let doneAt = Infinity;
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
      if (!bust && !target) setOwnClock(true);
      if (!bust) {
        shown = 0;
        latest.current.onCount(0);
        setClock(0);
      }
      const gap = Math.min(95, Math.max(36, 1200 / count));
      coins = Array.from({ length: count }, (_, i) => {
        const el = document.createElement('span');
        el.className = `jack-coin${bust ? ' is-lost' : ''}`;
        el.textContent = label;
        layer.appendChild(el);
        const angle = Math.random() * Math.PI * 2;
        const speed = 520 + Math.random() * 860;
        return {
          el,
          x: from.left + Math.random() * from.width,
          y: from.top + Math.random() * from.height,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - (bust ? 120 : 260),
          turn: (Math.random() - 0.5) * 30,
          spin: (Math.random() - 0.5) * 160,
          leaves: burstAt + BURST_MS + i * gap,
          from: null,
          bend: null,
          landed: false,
        };
      });
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

      if (coins.length) {
        if (target?.isConnected) goal = textCentre(target);
        else if (timeRef.current) {
          const r = timeRef.current.getBoundingClientRect();
          goal = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        const s = dt / 1000;
        for (const c of coins) {
          if (c.landed) continue;
          const age = t - burstAt;
          if (bust || t < c.leaves) {
            // Flung out, slowing in the air; a lost break's coins fall away.
            const drag = Math.exp(-(bust ? 1.2 : 3.4) * s);
            c.vx *= drag;
            c.vy = c.vy * drag + (bust ? 1500 : 160) * s;
            if (!bust && age > 280) {
              // Already feeling the clock's pull while waiting their turn.
              c.vx += (goal.x - c.x) * 1.1 * s;
              c.vy += (goal.y - c.y) * 1.1 * s;
            }
            c.x += c.vx * s;
            c.y += c.vy * s;
            c.turn += c.spin * s;
            const pop = Math.min(1, age / 120);
            c.el.style.transform = `translate(${c.x}px, ${c.y}px) translate(-50%, -50%) rotate(${c.turn}deg) scale(${0.4 + 0.6 * pop})`;
            if (bust) c.el.style.opacity = String(Math.max(0, 1 - age / (BURST_MS + 700)));
            continue;
          }
          // Pulled in: slow to leave, then faster and faster into the clock.
          c.from ??= { x: c.x, y: c.y };
          c.bend ??= { x: c.x + c.vx * 0.25, y: c.y + c.vy * 0.25 - 60 };
          const u = Math.min(1, (t - c.leaves) / FLIGHT_MS);
          const k = u ** 2.2;
          const a = 1 - k;
          const x = a * a * c.from.x + 2 * a * k * c.bend.x + k * k * goal.x;
          const y = a * a * c.from.y + 2 * a * k * c.bend.y + k * k * goal.y;
          c.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${c.turn * a}deg) scale(${1 - 0.45 * k})`;
          if (u >= 1) {
            c.landed = true;
            c.el.remove();
            land();
            if (closed) return;
          }
        }
      }

      if (t >= doneAt) {
        finish();
        return;
      }
      frame = requestAnimationFrame(step);
    };

    // The clock waits at 0:00 until the coins come in.
    l.onCount(0);
    frame = requestAnimationFrame(step);
    return () => {
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
      className={`jack-slot-layer is-${stage}${ownClock ? ' is-own-clock' : ''}${tense ? ' is-tense' : ''}`}
      onClick={() => {
        onCount(null);
        onDone();
      }}
    >
      <div
        className={`jack-slot-card glass glass-strong${tone}${big}`}
        role="status"
        aria-live="polite"
        aria-label={stage === 'spin' ? 'Spinning' : `${face.label}. ${resultLine(roll)}`}
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
          <div className="jack-lever">
            <span className="jack-lever-knob" />
          </div>
        </div>
        <div className="jack-slot-line tabular">{stage === 'spin' ? ' ' : resultLine(roll)}</div>
      </div>
    </div>,
    document.body,
  );
}
