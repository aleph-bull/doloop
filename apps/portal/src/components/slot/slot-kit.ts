/**
 * What Jack mode's slot machine and the rolls on Achievements share: the sounds, the reels'
 * motion and the coins that burst out of the window and fly into a number on the page.
 */

export const COIN_DROP = 'sounds/coin-drop.mp3';
export const COIN_COLLECT = 'sounds/coin-collect.mp3';

/** How far past the number a reel runs before it settles back, in numbers. */
export const OVERSHOOT = 0.22;
export const SETTLE_MS = 170;
/** Coins fly free before they're pulled in; each one's flight to its goal. */
export const BURST_MS = 520;
export const FLIGHT_MS = 400;

export function stillMotion(): boolean {
  const motion = document.documentElement.dataset.motion;
  if (motion === 'off') return true;
  if (motion === 'on') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export const easeOutQuart = (u: number) => 1 - (1 - u) ** 4;
export const easeOutCubic = (u: number) => 1 - (1 - u) ** 3;

/** The middle of the text itself, not of the box it sits in. */
export function textCentre(el: HTMLElement): { x: number; y: number } {
  const range = document.createRange();
  range.selectNodeContents(el);
  const r = range.getBoundingClientRect();
  const box = r.width > 0 ? r : el.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

export interface Coin {
  el: HTMLSpanElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  turn: number;
  spin: number;
  /** When it starts for the goal, ms into the show; then where it set off from. */
  leaves: number;
  from: { x: number; y: number } | null;
  bend: { x: number; y: number } | null;
  landed: boolean;
}

/**
 * Coins burst out of `from`, each a pill carrying `label`, flung every way at random. Coin
 * i sets off for its goal `leaves(i)` ms into the show. Lost coins (a lost break) are red
 * and fall away instead.
 */
export function burstCoins(
  layer: HTMLElement,
  from: DOMRect,
  count: number,
  label: string,
  lost: boolean,
  leaves: (i: number) => number,
): Coin[] {
  return Array.from({ length: count }, (_, i) => {
    const el = document.createElement('span');
    el.className = `jack-coin${lost ? ' is-lost' : ''}`;
    el.textContent = label;
    layer.appendChild(el);
    const angle = Math.random() * Math.PI * 2;
    const speed = 520 + Math.random() * 860;
    return {
      el,
      x: from.left + Math.random() * from.width,
      y: from.top + Math.random() * from.height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (lost ? 120 : 260),
      turn: (Math.random() - 0.5) * 30,
      spin: (Math.random() - 0.5) * 160,
      leaves: leaves(i),
      from: null,
      bend: null,
      landed: false,
    };
  });
}

/**
 * One frame of the coins, `t` ms into the show (`dt` since the last): flung out and slowing
 * in the air, already feeling the goal's pull, then drawn into it faster and faster. Lost
 * coins fall away. `onLand` runs for each that arrives; when it answers false the frame
 * stops there, and so does this (false).
 */
export function stepCoins(
  coins: Coin[],
  t: number,
  dt: number,
  burstAt: number,
  goal: { x: number; y: number },
  lost: boolean,
  onLand: () => boolean,
): boolean {
  const s = dt / 1000;
  for (const c of coins) {
    if (c.landed) continue;
    const age = t - burstAt;
    if (lost || t < c.leaves) {
      // Flung out, slowing in the air; a lost break's coins fall away.
      const drag = Math.exp(-(lost ? 1.2 : 3.4) * s);
      c.vx *= drag;
      c.vy = c.vy * drag + (lost ? 1500 : 160) * s;
      if (!lost && age > 280) {
        // Already feeling the goal's pull while waiting their turn.
        c.vx += (goal.x - c.x) * 1.1 * s;
        c.vy += (goal.y - c.y) * 1.1 * s;
      }
      c.x += c.vx * s;
      c.y += c.vy * s;
      c.turn += c.spin * s;
      const pop = Math.min(1, age / 120);
      c.el.style.transform = `translate(${c.x}px, ${c.y}px) translate(-50%, -50%) rotate(${c.turn}deg) scale(${0.4 + 0.6 * pop})`;
      if (lost) c.el.style.opacity = String(Math.max(0, 1 - age / (BURST_MS + 700)));
      continue;
    }
    // Pulled in: slow to leave, then faster and faster into the goal.
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
      if (!onLand()) return false;
    }
  }
  return true;
}
