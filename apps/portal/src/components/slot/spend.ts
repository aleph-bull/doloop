import { fireSparks } from '@komogon/ui';
import { playEffect, preloadEffects } from '../../lib/sounds';
import {
  burstCoins,
  COIN_COLLECT,
  COIN_DROP,
  easeOutCubic,
  stepCoins,
  stillMotion,
  type Coin,
} from './slot-kit';

/**
 * Buying something on Achievements: the slot machine's coins the other way round. They burst
 * out of your XP, which counts down, and are drawn one after another into what you bought,
 * a rising note each; the last lands with a pop, sparks and a ring round the card.
 */

/** The rolls' pop for the smaller wins, as the last coin lands. */
const POP = 'sounds/roll-pop.mp3';
/** While the pill at the top drops in, before its coins burst out. */
const PILL_IN_MS = 240;
/** The coins hang in the air at least this long before they're drawn in. */
const HANG_MS = 300;
/** XP counting down as the coins leave, or back up when it didn't go through. */
export const COUNT_MS = 520;

export function preloadSpend(): void {
  preloadEffects([COIN_DROP, COIN_COLLECT, POP]);
}

/** A few coins for a small price, more for a big one, never a flood. */
export function coinsFor(cost: number): number {
  return Math.max(5, Math.min(18, Math.round(4 + Math.sqrt(Math.max(0, cost)) / 2)));
}

export interface SpendOptions {
  /** The XP on the page. Off screen, a pill with it drops in at the top instead. */
  wallet: HTMLElement | null;
  /** The card bought from, and what in it the coins fly into. */
  card: () => HTMLElement | null;
  goal: () => HTMLElement | null;
  cost: number;
  /** XP before paying, for the pill. */
  before: number;
  /** 0..1, or 0 for no sound. */
  volume: number;
  /** Rises from the goal as the last coin lands, e.g. "+1". */
  float?: string;
}

export interface Spend {
  /** It went through: the coins fly in. Resolves as the last one lands. */
  land: () => Promise<void>;
  /** It didn't: the coins fall away and the pill counts back up. */
  drop: () => void;
}

function onScreen(el: HTMLElement | null): el is HTMLElement {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
}

function centre(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** A quick squeeze or swell, done with the element's own transform. */
function bump(el: Element | null, from: number, ms: number): void {
  if (!el || typeof (el as HTMLElement).animate !== 'function') return;
  (el as HTMLElement).animate([{ transform: `scale(${from})` }, { transform: 'scale(1)' }], {
    duration: ms,
    easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
  });
}

/** The finish: a ring out from the card, the card pops, sparks and the float from the goal. */
function finish(layer: HTMLElement, o: SpendOptions): void {
  const card = o.card();
  const goal = o.goal();
  if (card) {
    const r = card.getBoundingClientRect();
    const ring = document.createElement('span');
    ring.className = 'buy-ring';
    ring.style.left = `${r.left}px`;
    ring.style.top = `${r.top}px`;
    ring.style.width = `${r.width}px`;
    ring.style.height = `${r.height}px`;
    ring.style.borderRadius = getComputedStyle(card).borderRadius;
    layer.appendChild(ring);
    card.classList.remove('buy-pop');
    void card.offsetWidth;
    card.classList.add('buy-pop');
    card.addEventListener('animationend', () => card.classList.remove('buy-pop'), {
      once: true,
    });
  }
  if (goal) {
    const at = centre(goal);
    fireSparks({ origin: at, count: 18, durationMs: 700 });
    if (o.float) {
      const float = document.createElement('span');
      float.className = 'buy-float tabular';
      float.textContent = o.float;
      float.style.left = `${at.x}px`;
      float.style.top = `${goal.getBoundingClientRect().top}px`;
      layer.appendChild(float);
    }
  }
}

export function spendXp(o: SpendOptions): Spend {
  const volume = o.volume;
  if (stillMotion()) {
    return {
      land: () => {
        playEffect(POP, volume, 1.05);
        return Promise.resolve();
      },
      drop: () => {},
    };
  }

  const layer = document.createElement('div');
  layer.className = 'buy-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);

  let pill: HTMLSpanElement | null = null;
  let source: HTMLElement;
  if (onScreen(o.wallet)) source = o.wallet;
  else {
    pill = document.createElement('span');
    pill.className = 'buy-wallet tabular';
    pill.textContent = `${o.before.toLocaleString()} XP`;
    layer.appendChild(pill);
    source = pill;
  }
  const burstAt = pill ? PILL_IN_MS : 0;
  const after = Math.max(0, o.before - o.cost);
  /** The pill's number: from, to, and when it started counting. */
  let count: { from: number; to: number; at: number } | null = null;
  let shown = o.before;

  let coins: Coin[] = [];
  let burst = false;
  let paid = false;
  let lost = false;
  let dropAt = 0;
  let landed = 0;
  let finished = false;
  let resolve: (() => void) | null = null;
  const landedAll = new Promise<void>((r) => (resolve = r));

  let t = 0;
  let prev = performance.now();
  let frame = 0;

  const close = () => {
    cancelAnimationFrame(frame);
    for (const c of coins) c.el.remove();
    pill?.classList.add('is-leaving');
    window.setTimeout(() => layer.remove(), 900);
    resolve?.();
  };

  /** The coins set off one after another, the nearest first. */
  const drawIn = () => {
    const goal = o.goal();
    if (!goal) {
      finished = true;
      return close();
    }
    const at = centre(goal);
    const order = [...coins].sort(
      (a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y),
    );
    const gap = Math.max(28, Math.min(70, 560 / coins.length));
    const start = Math.max(t, burstAt + HANG_MS);
    order.forEach((c, i) => (c.leaves = start + i * gap));
  };

  const coinIn = () => {
    landed += 1;
    const total = coins.length;
    const last = landed === total;
    playEffect(COIN_COLLECT, volume, 0.95 + 0.6 * (landed / total), total > 14 ? 0.5 : 0.7);
    // A chip can swell a third; a picture only a little, or it covers the ones beside it.
    const goal = o.goal();
    const small = !!goal && goal.getBoundingClientRect().width < 96;
    if (last) bump(goal, small ? 1.32 : 1.06, 520);
    else bump(goal, small ? 1.12 : 1.025, 180);
    if (last) {
      finished = true;
      playEffect(POP, volume, 1.05);
      finish(layer, o);
      resolve?.();
      // The pill stays a moment with the new total, then goes.
      window.setTimeout(close, pill ? 420 : 0);
    }
    return true;
  };

  const step = (now: number) => {
    const dt = Math.min(50, now - prev);
    prev = now;
    t += dt;

    if (!burst && t >= burstAt && !lost) {
      burst = true;
      const from = source.getBoundingClientRect();
      coins = burstCoins(layer, from, coinsFor(o.cost), 'XP', false, () => Infinity);
      for (const c of coins) {
        c.el.classList.add('is-buy');
        // A pop round the XP, not the slot machine's spray across the screen.
        c.vx *= 0.42;
        c.vy *= 0.42;
      }
      playEffect(COIN_DROP, volume, 1.2, 0.8);
      bump(source, 0.84, 340);
      count = { from: o.before, to: after, at: t };
      if (paid) drawIn();
    }

    if (count && pill) {
      const u = Math.min(1, (t - count.at) / COUNT_MS);
      const n = Math.round(count.from + (count.to - count.from) * easeOutCubic(u));
      if (n !== shown) {
        shown = n;
        pill.textContent = `${n.toLocaleString()} XP`;
      }
    }

    if (coins.length && !finished) {
      const goal = o.goal();
      const at = goal ? centre(goal) : { x: 0, y: 0 };
      stepCoins(coins, t, dt, lost ? dropAt : burstAt, at, lost, coinIn);
    }

    if (lost && t - dropAt > 1300) return close();
    if (finished) return;
    if (lost && !burst) return close();
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);

  return {
    land: () => {
      if (!lost && !paid) {
        paid = true;
        if (burst) drawIn();
      }
      return landedAll;
    },
    drop: () => {
      if (paid || lost) return;
      lost = true;
      dropAt = t;
      for (const c of coins) c.el.classList.add('is-lost');
      if (pill) count = { from: shown, to: o.before, at: t };
    },
  };
}
