import { motionLevel, ribbonNoise, ringNoise, type AnalysisState } from '@doloop/core';
import { hexToRgb, type RGB } from './contrast';

/**
 * The visualizer's picture, as one pure function over a 2D context. The React component
 * owns the canvas, the sizing and the animation loop; this owns what a frame looks like,
 * so it can be drawn on any canvas without mounting anything.
 *
 * Soft neon ribbons drift across the top and bottom of the screen, fluid rings sit around
 * the clock, a bloom pulses on a kick and a ring rolls out on a drop. Everything is
 * additive and blurred, so it reads as light rather than shapes, and nothing crosses the
 * middle of the screen where the timer lives.
 */

export interface VisualizerPalette {
  /** Hex. Ribbons and rings sweep from `from` to `to`; a single colour sets both the same. */
  from: string;
  to: string;
}

export interface VisualizerColors {
  key: string;
  ribbons: string[];
  rings: string[];
  fromCss: string;
  toCss: string;
  bloom: CanvasGradient;
}

export interface VisualizerScene {
  /** CSS pixels. */
  width: number;
  height: number;
  /** Device pixels per CSS pixel the canvas was sized with. */
  dpr: number;
}

export interface VisualizerFrame {
  seconds: number;
  state: AnalysisState;
  /** 0..1 */
  intensity: number;
  /** 0..1: how strongly the whole layer shows over the background. */
  opacity: number;
  colors: VisualizerColors;
  /** Which parts to draw. All on when omitted. */
  layers?: { ribbons: boolean; rings: boolean; border: boolean };
}

const LOWER_RIBBONS = 4;
const UPPER_RIBBONS = 2;
const RIBBON_POINTS = 64;
const RINGS = 3;
const RING_POINTS = 96;
/** The ribbons live in these bands of the height, clear of the timer in the middle. */
const LOWER_BAND: readonly [number, number] = [0.73, 0.94];
const UPPER_BAND: readonly [number, number] = [0.05, 0.19];
/** Ring radius as a fraction of the shorter side, and the step between rings. */
const RING_RADIUS = 0.3;
const RING_STEP = 0.055;
/** A drop's ring is gone after this many seconds. */
export const SHOCK_SECONDS = 1.4;

function mix(a: RGB, b: RGB, t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r} ${g} ${bl})`;
}

export function paletteKey(palette: VisualizerPalette): string {
  return `${palette.from}|${palette.to}`;
}

/** Strings and gradients are built once per palette, never per frame. */
export function buildColors(
  ctx: CanvasRenderingContext2D,
  palette: VisualizerPalette,
): VisualizerColors {
  const from = hexToRgb(palette.from);
  const to = hexToRgb(palette.to);
  const ribbons: string[] = [];
  const total = LOWER_RIBBONS + UPPER_RIBBONS;
  for (let i = 0; i < total; i++) ribbons.push(mix(from, to, i / Math.max(1, total - 1)));
  const rings: string[] = [];
  for (let i = 0; i < RINGS; i++) rings.push(mix(from, to, i / Math.max(1, RINGS - 1)));
  // Unit-radius bloom, scaled by a transform at draw time.
  const bloom = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  bloom.addColorStop(0, `rgb(${from[0]} ${from[1]} ${from[2]} / 0.9)`);
  bloom.addColorStop(0.45, `rgb(${to[0]} ${to[1]} ${to[2]} / 0.35)`);
  bloom.addColorStop(1, `rgb(${to[0]} ${to[1]} ${to[2]} / 0)`);
  return {
    key: paletteKey(palette),
    ribbons,
    rings,
    fromCss: mix(from, from, 0),
    toCss: mix(to, to, 0),
    bloom,
  };
}

function ribbon(
  ctx: CanvasRenderingContext2D,
  scene: VisualizerScene,
  index: number,
  band: readonly [number, number],
  count: number,
  amp: number,
  seconds: number,
  glow: number,
  alpha: number,
  color: string,
): void {
  const { width, height } = scene;
  const baseY = height * (band[0] + ((band[1] - band[0]) * (index + 0.5)) / count);
  const ampPx = height * 0.028 * (1 + 2.4 * amp);
  const speed = 0.5 + 0.12 * index;
  ctx.beginPath();
  for (let j = 0; j <= RIBBON_POINTS; j++) {
    const u = j / RIBBON_POINTS;
    const n = ribbonNoise(u * 5.5 + index * 1.37, seconds * speed);
    const swell = Math.sin(u * Math.PI) * amp * height * 0.02;
    const y = baseY + n * ampPx - swell;
    const x = u * width;
    if (j === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  // A wide, faint pass is the bloom; the thin pass on top is the line.
  ctx.lineWidth = 6 + 10 * amp;
  ctx.shadowBlur = glow * 2.2;
  ctx.globalAlpha = alpha * 0.45;
  ctx.stroke();
  ctx.lineWidth = 1.4 + 2.4 * amp;
  ctx.shadowBlur = glow;
  ctx.globalAlpha = alpha;
  ctx.stroke();
}

function ring(
  ctx: CanvasRenderingContext2D,
  index: number,
  cx: number,
  cy: number,
  radius: number,
  amp: number,
  seconds: number,
  glow: number,
  alpha: number,
  color: string,
  offsetX: number,
): void {
  ctx.beginPath();
  for (let j = 0; j <= RING_POINTS; j++) {
    const a = (j / RING_POINTS) * Math.PI * 2;
    const n = ringNoise(a + index * 2.1, seconds + index);
    const r = radius * (1 + 0.045 * n + 0.13 * amp * (1 + 0.35 * index));
    const x = cx + offsetX + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (j === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.lineWidth = 4 + 6 * amp;
  ctx.shadowBlur = glow * 2;
  ctx.globalAlpha = alpha * 0.4;
  ctx.stroke();
  ctx.lineWidth = 1.1 + 1.6 * amp;
  ctx.shadowBlur = glow;
  ctx.globalAlpha = alpha;
  ctx.stroke();
}

/** Draw one frame. Clears the canvas first; leaves the context in its default state. */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  scene: VisualizerScene,
  frame: VisualizerFrame,
): void {
  const { width, height, dpr } = scene;
  const { seconds, state, colors } = frame;

  const k = 0.35 + 0.95 * Math.min(1, Math.max(0, frame.intensity));
  const level = motionLevel(state, seconds);
  const amp = Math.min(1, level * k);
  const pulse = state.pulse * k;
  const shock = state.shock * k;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const glow = (14 + 40 * amp) * (0.5 + k * 0.6);
  const opacity = Math.min(1, Math.max(0, frame.opacity));
  const layers = frame.layers ?? { ribbons: true, rings: true, border: true };

  // Ribbons: the lower group carries the motion, the upper group echoes it faintly. They
  // are drawn first and masked on their own, so their ends fade out while the border
  // and rings, drawn afterwards, keep their edges.
  for (let i = 0; layers.ribbons && i < LOWER_RIBBONS; i++) {
    ribbon(
      ctx,
      scene,
      i,
      LOWER_BAND,
      LOWER_RIBBONS,
      amp,
      seconds,
      glow,
      (0.18 + 0.46 * amp) * opacity,
      colors.ribbons[i]!,
    );
  }
  for (let i = 0; layers.ribbons && i < UPPER_RIBBONS; i++) {
    ribbon(
      ctx,
      scene,
      i + LOWER_RIBBONS,
      UPPER_BAND,
      UPPER_RIBBONS,
      amp * 0.7,
      seconds + 7,
      glow * 0.7,
      (0.1 + 0.24 * amp) * opacity,
      colors.ribbons[i + LOWER_RIBBONS]!,
    );
  }

  if (layers.ribbons) {
    // Fade both ends to nothing so no ribbon ends on a hard line.
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-in';
    const mask = ctx.createLinearGradient(0, 0, width, 0);
    mask.addColorStop(0, 'rgb(0 0 0 / 0)');
    mask.addColorStop(0.1, 'rgb(0 0 0 / 1)');
    mask.addColorStop(0.9, 'rgb(0 0 0 / 1)');
    mask.addColorStop(1, 'rgb(0 0 0 / 0)');
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';
  }

  // Rings around the clock. On a drop they split slightly into the two palette colours.
  const cx = width / 2;
  const cy = height / 2;
  const base = Math.min(width, height) * RING_RADIUS;
  const split = shock * 5;
  for (let i = 0; layers.rings && i < RINGS; i++) {
    const radius = base + i * Math.min(width, height) * RING_STEP;
    const alpha = (0.1 + 0.32 * amp + 0.15 * pulse) * opacity;
    if (split > 0.4) {
      ring(ctx, i, cx, cy, radius, amp, seconds, glow * 0.8, alpha * 0.6, colors.fromCss, -split);
      ring(ctx, i, cx, cy, radius, amp, seconds, glow * 0.8, alpha * 0.6, colors.toCss, split);
    } else {
      ring(ctx, i, cx, cy, radius, amp, seconds, glow * 0.8, alpha, colors.rings[i]!, 0);
    }
  }

  // Bloom: a soft light behind the timer that lifts on a kick.
  const bloomAlpha = (0.04 + 0.26 * pulse + 0.18 * shock) * (0.6 + k * 0.4);
  const bloomRadius = base * (0.85 + 0.45 * pulse + 0.2 * amp);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = Math.min(0.6, bloomAlpha) * opacity;
  ctx.setTransform(dpr * bloomRadius, 0, 0, dpr * bloomRadius, dpr * cx, dpr * cy);
  ctx.fillStyle = colors.bloom;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // The edge: a soft glowing frame around the whole screen that breathes with the level
  // and brightens on a hit, in the palette's two colours from left to right.
  if (layers.border) {
    const inset = 3;
    const r = 18;
    const w = width - inset * 2;
    const h = height - inset * 2;
    ctx.beginPath();
    ctx.moveTo(inset + r, inset);
    ctx.lineTo(inset + w - r, inset);
    ctx.quadraticCurveTo(inset + w, inset, inset + w, inset + r);
    ctx.lineTo(inset + w, inset + h - r);
    ctx.quadraticCurveTo(inset + w, inset + h, inset + w - r, inset + h);
    ctx.lineTo(inset + r, inset + h);
    ctx.quadraticCurveTo(inset, inset + h, inset, inset + h - r);
    ctx.lineTo(inset, inset + r);
    ctx.quadraticCurveTo(inset, inset, inset + r, inset);
    ctx.closePath();
    const edge = ctx.createLinearGradient(0, 0, width, 0);
    edge.addColorStop(0, colors.fromCss);
    edge.addColorStop(1, colors.toCss);
    ctx.strokeStyle = edge;
    ctx.shadowColor = colors.fromCss;
    const edgeAlpha = (0.14 + 0.5 * amp + 0.35 * pulse + 0.3 * shock) * opacity;
    // Wide halo, then the line.
    ctx.lineWidth = 14 + 22 * amp;
    ctx.shadowBlur = 50 + 60 * amp;
    ctx.globalAlpha = edgeAlpha * 0.5;
    ctx.stroke();
    ctx.lineWidth = 2 + 3 * amp;
    ctx.shadowBlur = 24 + 30 * amp;
    ctx.globalAlpha = edgeAlpha;
    ctx.stroke();
  }

  // Shockwave: one ring rolling outward from a drop, gone within a second and a half.
  if (state.shockAge < SHOCK_SECONDS) {
    const life = 1 - state.shockAge / SHOCK_SECONDS;
    ctx.beginPath();
    ctx.arc(cx, cy, base * (1 + state.shockAge * 1.7), 0, Math.PI * 2);
    ctx.lineWidth = 0.6 + 3 * life;
    ctx.strokeStyle = colors.toCss;
    ctx.shadowColor = colors.toCss;
    ctx.shadowBlur = 30 + 30 * life;
    ctx.globalAlpha = 0.5 * life * k * opacity;
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
