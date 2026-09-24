import { motionLevel, ribbonNoise, ringNoise, shiftHue, type AnalysisState } from '@komogon/core';
import { hexToRgb, type RGB } from './contrast';
import { makeMistTexture } from './mist-texture';

/**
 * The visualizer's picture, as one pure function over a 2D context. The React component
 * owns the canvas, the sizing and the animation loop; this owns what a frame looks like,
 * so it can be drawn on any canvas without mounting anything.
 *
 * A cloud of mist breathes along the bottom edge, soft neon ribbons drift across the top
 * and bottom of the screen, fluid rings sit around the clock, a row of neon bars stands
 * along the bottom, a mirrored line can be hung at any height, a bloom pulses on a kick and
 * a ring rolls out on a drop. Everything is additive and blurred, so it reads as light
 * rather than shapes, and by default nothing crosses the middle of the screen where the
 * timer lives.
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
  fromRgb: RGB;
  toRgb: RGB;
  /** `from` pulled most of the way to white: the hot core of a bar, the line itself. */
  hotCss: string;
  hotRgb: RGB;
  /** The line's mirror: `to`, or a neighbouring hue when the palette is one colour. */
  mirrorCss: string;
  mirrorRgb: RGB;
  bloom: CanvasGradient;
  /**
   * Two cloud banks as pictures, built on the first mist frame (they cost a moment) and
   * scrolled at different scales. Null where there is no document to draw them on.
   */
  mistTextures?: [HTMLCanvasElement, HTMLCanvasElement] | null;
  /** The line's side fades, rebuilt only when the width changes. */
  waveFades?: { width: number; line: CanvasGradient; hot: CanvasGradient; mirror: CanvasGradient };
}

export interface VisualizerLayers {
  mist: boolean;
  ribbons: boolean;
  /** The ring that rolls out from the clock on a drop. Detection runs regardless. */
  shockwave: boolean;
  rings: boolean;
  bars: boolean;
  waveform: boolean;
}

export const ALL_LAYERS: VisualizerLayers = {
  mist: true,
  ribbons: true,
  shockwave: true,
  rings: true,
  bars: true,
  waveform: true,
};

export interface MistLook {
  /** How far up the screen the mist reaches, as a fraction of the height. */
  height: number;
  /** How fast the clouds drift, 0..1. */
  drift: number;
  /** How strongly the mist shows, 0..1, on top of the frame's opacity. */
  opacity: number;
}

export const DEFAULT_MIST_LOOK: MistLook = { height: 0.3, drift: 0.5, opacity: 1 };

export interface WavesLook {
  /** Waves across the lower band, 1..MAX_WAVES; the upper band carries about half as many. */
  count: number;
}

export const DEFAULT_WAVES_LOOK: WavesLook = { count: 4 };

export interface BarsLook {
  /** How many bars stand in the row. */
  count: number;
  /** The tallest bar, as a fraction of the height. */
  height: number;
  /** The share of each bar's slot left empty, 0..1. */
  gap: number;
  /** How much bloom, 0..1. */
  glow: number;
  /** A faint reflection hung under the row. */
  reflection: boolean;
  /** Bass in the middle, mirrored outward, rather than left to right. */
  symmetric: boolean;
}

export const DEFAULT_BARS_LOOK: BarsLook = {
  count: 48,
  height: 0.22,
  gap: 0.35,
  glow: 0.7,
  reflection: true,
  symmetric: false,
};

export interface WaveformLook {
  /** Where the line's axis sits, as a fraction of the height from the top. */
  position: number;
}

export const DEFAULT_WAVEFORM_LOOK: WaveformLook = { position: 0.18 };

/** Points the line is drawn through; the shape array a caller passes should be this long. */
export const WAVEFORM_POINTS = 160;

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
  layers?: VisualizerLayers;
  /** The bar levels (0..1 each, `count` of them) and how to draw them. Skipped when omitted. */
  bars?: { levels: Float32Array; count: number; look: BarsLook };
  /** The line's shape (-1..1 per point) and where to hang it. Skipped when omitted. */
  waveform?: { shape: Float32Array; look: WaveformLook };
  /** How the mist is laid out. Skipped when omitted. */
  mist?: { look: MistLook };
  /** How many waves. Four and two when omitted. */
  waves?: { look: WavesLook };
}

/** The most waves the lower band takes; the upper band carries about half as many. */
export const MAX_WAVES = 12;
/** Colour steps built once per palette and picked by position along the row. */
const RIBBON_SHADES = 18;
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
/** The bars stand on this fraction of the height, higher when a reflection hangs below. */
const BAR_BASE = 0.965;
const BAR_BASE_REFLECTED = 0.9;
/** Each side of the row is left clear by this fraction of the width. */
const BAR_MARGIN = 0.05;
/** The reflection is this tall relative to its bar, fading to nothing over that. */
const REFLECTION = 0.55;
/** The line fades in and out over this fraction of the width at each end. */
const WAVE_FADE = 0.14;
/** The mist's two banks: how much wider than the screen one tile is, and how fast each scrolls. */
const MIST_BACK_STRETCH = 1.9;
const MIST_FRONT_STRETCH = 1.15;
const MIST_BACK_SPEED = 0.05;
const MIST_FRONT_SPEED = -0.085;

function mix(a: RGB, b: RGB, t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r} ${g} ${bl})`;
}

function rgba(c: RGB, alpha: number): string {
  return `rgb(${c[0]} ${c[1]} ${c[2]} / ${alpha})`;
}

function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
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
  for (let i = 0; i < RIBBON_SHADES; i++) ribbons.push(mix(from, to, i / (RIBBON_SHADES - 1)));
  const rings: string[] = [];
  for (let i = 0; i < RINGS; i++) rings.push(mix(from, to, i / Math.max(1, RINGS - 1)));
  // Unit-radius bloom, scaled by a transform at draw time.
  const bloom = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  bloom.addColorStop(0, `rgb(${from[0]} ${from[1]} ${from[2]} / 0.9)`);
  bloom.addColorStop(0.45, `rgb(${to[0]} ${to[1]} ${to[2]} / 0.35)`);
  bloom.addColorStop(1, `rgb(${to[0]} ${to[1]} ${to[2]} / 0)`);
  const hot = mixRgb(from, [255, 255, 255], 0.6);
  const mirror = hexToRgb(palette.from === palette.to ? shiftHue(palette.to, 45) : palette.to);
  return {
    key: paletteKey(palette),
    ribbons,
    rings,
    fromCss: mix(from, from, 0),
    toCss: mix(to, to, 0),
    fromRgb: from,
    toRgb: to,
    hotCss: mix(hot, hot, 0),
    hotRgb: hot,
    mirrorCss: mix(mirror, mirror, 0),
    mirrorRgb: mirror,
    bloom,
  };
}

/**
 * The mist: two banks of cloud, each a noise texture built once per palette, scrolled along
 * the bottom edge at different scales and speeds so they slide past each other the way real
 * cloud layers do. The low end lifts and brightens both, a hit swells them, and in silence
 * they settle to a slow, faint drift. Under `lighter` the overlaps glow. No strokes, no
 * shadow blur: two texture draws and a gradient.
 */
function mist(
  ctx: CanvasRenderingContext2D,
  scene: VisualizerScene,
  frame: VisualizerFrame,
  k: number,
  amp: number,
  pulse: number,
  opacity: number,
): void {
  const { width, height } = scene;
  const { seconds, colors } = frame;
  const look = frame.mist!.look;
  if (colors.mistTextures === undefined) {
    const back = makeMistTexture(colors.fromRgb, colors.toRgb, 3);
    const front = makeMistTexture(colors.fromRgb, colors.toRgb, 11);
    colors.mistTextures = back && front ? [back, front] : null;
  }
  const textures = colors.mistTextures;
  if (!textures) return;
  const reach = height * Math.min(1, Math.max(0.05, look.height)) * (0.75 + 0.25 * k);
  const t = seconds * (0.08 + 0.35 * Math.min(1, Math.max(0, look.drift)));
  // The mist's own opacity sits on top of the visualizer's.
  opacity *= Math.min(1, Math.max(0, look.opacity));

  ctx.shadowBlur = 0;
  // A faint bank of light along the edge, so the cloud has something to sit in.
  const bank = ctx.createLinearGradient(0, height - reach * 0.7, 0, height);
  bank.addColorStop(0, rgba(colors.toRgb, 0));
  bank.addColorStop(1, rgba(colors.toRgb, 0.28));
  ctx.fillStyle = bank;
  ctx.globalAlpha = (0.25 + 0.5 * amp + 0.25 * pulse) * opacity;
  ctx.fillRect(0, height - reach * 0.7, width, reach * 0.7);

  // One bank: the texture tiled across the width from a scroll phase, `stretch` screens wide.
  const bankOf = (
    tex: HTMLCanvasElement,
    phase: number,
    stretch: number,
    tall: number,
    alpha: number,
  ) => {
    const tile = width * stretch;
    const start = -((((phase % 1) + 1) % 1) * tile);
    ctx.globalAlpha = alpha;
    for (let x = start; x < width; x += tile) ctx.drawImage(tex, x, height - tall, tile, tall);
  };
  const swell = 0.5 + 0.5 * ribbonNoise(1.3, t * 0.9);
  bankOf(
    textures[0],
    t * MIST_BACK_SPEED,
    MIST_BACK_STRETCH,
    reach * (0.85 + 0.15 * swell + 0.25 * amp + 0.15 * pulse),
    (0.3 + 0.35 * amp + 0.15 * pulse) * opacity,
  );
  bankOf(
    textures[1],
    t * MIST_FRONT_SPEED + 0.37,
    MIST_FRONT_STRETCH,
    reach * (0.6 + 0.2 * swell + 0.35 * amp + 0.25 * pulse),
    (0.35 + 0.45 * amp + 0.25 * pulse) * opacity,
  );
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

/**
 * The neon bars: a row along the bottom, each bar the loudest part of its band. One path
 * holds the whole row, filled three times with a narrowing blur so the light adds up into
 * a bloom, then a thinner, whiter core down each bar so it reads as a tube of light. The
 * colour climbs from `from` at the base to `to` at the top of the tallest bar.
 */
function bars(
  ctx: CanvasRenderingContext2D,
  scene: VisualizerScene,
  frame: VisualizerFrame,
  k: number,
  amp: number,
  pulse: number,
  opacity: number,
): void {
  const { width, height } = scene;
  const { levels, count, look } = frame.bars!;
  const { colors } = frame;
  const n = Math.max(1, Math.min(Math.round(count), levels.length));
  const margin = width * BAR_MARGIN;
  const slot = (width - margin * 2) / n;
  const barW = Math.max(1, slot * (1 - Math.min(0.9, Math.max(0, look.gap))));
  const baseY = height * (look.reflection ? BAR_BASE_REFLECTED : BAR_BASE);
  const maxH = height * look.height * (0.6 + 0.4 * k) * (1 + 0.12 * pulse);
  const radius = Math.min(barW / 2, 5);
  const glow = Math.min(1, Math.max(0, look.glow));

  // Symmetric rows put the lowest band in the middle and count outward from it.
  const heightOf = (j: number): number => {
    const i = look.symmetric ? Math.floor(Math.abs(j - (n - 1) / 2)) : j;
    return Math.max(2, (levels[i] ?? 0) * maxH);
  };
  const row = (up: boolean, scale: number, inset: number) => {
    ctx.beginPath();
    for (let j = 0; j < n; j++) {
      const h = heightOf(j) * scale;
      const x = margin + j * slot + (slot - barW) / 2 + barW * inset;
      const w = barW * (1 - inset * 2);
      ctx.roundRect(x, up ? baseY - h : baseY, w, h, radius * (1 - inset));
    }
  };

  const grad = ctx.createLinearGradient(0, baseY, 0, baseY - maxH);
  grad.addColorStop(0, colors.fromCss);
  grad.addColorStop(1, colors.toCss);

  row(true, 1, 0);
  ctx.fillStyle = grad;
  ctx.shadowColor = colors.fromCss;
  // Wide bloom, tighter halo, then the bar itself; all three add up under 'lighter'.
  ctx.shadowBlur = 24 + 56 * glow;
  ctx.globalAlpha = (0.18 + 0.42 * glow) * opacity;
  ctx.fill();
  ctx.shadowBlur = 8 + 16 * glow;
  ctx.globalAlpha = (0.3 + 0.3 * glow) * opacity;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.85 * opacity;
  ctx.fill();
  row(true, 1, 0.3);
  ctx.fillStyle = colors.hotCss;
  ctx.globalAlpha = (0.22 + 0.3 * glow) * opacity;
  ctx.fill();

  // A hairline along the base, glowing a little: the shelf the bars stand on.
  ctx.beginPath();
  ctx.moveTo(margin, baseY);
  ctx.lineTo(width - margin, baseY);
  ctx.strokeStyle = colors.fromCss;
  ctx.lineWidth = 1;
  ctx.shadowBlur = 10 + 10 * glow;
  ctx.globalAlpha = (0.25 + 0.25 * amp) * opacity;
  ctx.stroke();
  ctx.shadowBlur = 0;

  if (look.reflection) {
    // The same row hung upside down, fading to nothing well before it reaches full height.
    row(false, REFLECTION, 0);
    const refl = ctx.createLinearGradient(0, baseY, 0, baseY + maxH * REFLECTION);
    refl.addColorStop(0, rgba(colors.fromRgb, 0.5));
    refl.addColorStop(1, rgba(colors.fromRgb, 0));
    ctx.fillStyle = refl;
    ctx.globalAlpha = 0.7 * opacity;
    ctx.fill();
  } else {
    // Without a reflection the base glows instead, a soft band the bars rise out of.
    const band = height * 0.07;
    const floor = ctx.createLinearGradient(0, baseY - band, 0, baseY);
    floor.addColorStop(0, rgba(colors.fromRgb, 0));
    floor.addColorStop(1, rgba(colors.fromRgb, 0.35));
    ctx.fillStyle = floor;
    ctx.globalAlpha = (0.4 + 0.6 * amp) * glow * opacity;
    ctx.fillRect(margin, baseY - band, width - margin * 2, band);
  }
}

/**
 * The mirrored line: the waveform drawn across the screen at a chosen height, a bright
 * core over a wide soft pass, with its reflection hung under the axis in the palette's far
 * colour. Both fade out toward the sides, so the line dissolves rather than stopping.
 */
function waveform(
  ctx: CanvasRenderingContext2D,
  scene: VisualizerScene,
  frame: VisualizerFrame,
  k: number,
  amp: number,
  glow: number,
  opacity: number,
): void {
  const { width, height } = scene;
  const { shape, look } = frame.waveform!;
  const { colors } = frame;
  const n = shape.length;
  if (n < 2) return;
  const baseY = height * Math.min(1, Math.max(0, look.position));
  const ampPx = height * 0.12 * (0.45 + 0.55 * k);

  if (!colors.waveFades || colors.waveFades.width !== width) {
    const fade = (rgb: RGB) => {
      const g = ctx.createLinearGradient(0, 0, width, 0);
      g.addColorStop(0, rgba(rgb, 0));
      g.addColorStop(WAVE_FADE, rgba(rgb, 1));
      g.addColorStop(1 - WAVE_FADE, rgba(rgb, 1));
      g.addColorStop(1, rgba(rgb, 0));
      return g;
    };
    colors.waveFades = {
      width,
      line: fade(colors.fromRgb),
      hot: fade(colors.hotRgb),
      mirror: fade(colors.mirrorRgb),
    };
  }
  const fades = colors.waveFades;

  const trace = (sign: number, scale: number) => {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * width;
      const y = baseY - sign * shape[i]! * ampPx * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };

  trace(1, 1);
  ctx.shadowColor = colors.fromCss;
  ctx.strokeStyle = fades.line;
  ctx.lineWidth = 5 + 6 * amp;
  ctx.shadowBlur = glow * 1.6;
  ctx.globalAlpha = 0.35 * opacity;
  ctx.stroke();
  ctx.strokeStyle = fades.hot;
  ctx.lineWidth = 1.6 + 0.8 * amp;
  ctx.shadowBlur = glow * 0.8;
  ctx.globalAlpha = 0.95 * opacity;
  ctx.stroke();

  // Fainter, a little smaller and a little softer than the line, as a reflection is.
  trace(-1, 0.75);
  ctx.shadowColor = colors.mirrorCss;
  ctx.strokeStyle = fades.mirror;
  ctx.lineWidth = 4 + 4 * amp;
  ctx.shadowBlur = glow;
  ctx.globalAlpha = 0.12 * opacity;
  ctx.stroke();
  ctx.lineWidth = 1.1;
  ctx.shadowBlur = glow * 0.5;
  ctx.globalAlpha = 0.34 * opacity;
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
  const layers = frame.layers ?? ALL_LAYERS;

  // Ribbons: the lower group carries the motion, the upper group echoes it faintly. They
  // are drawn first and masked on their own, so their ends fade out while everything
  // drawn afterwards keeps its edges.
  const lower = Math.max(1, Math.min(MAX_WAVES, Math.round(frame.waves?.look.count ?? 4)));
  const upper = Math.max(1, Math.round(lower / 2));
  const total = lower + upper;
  // The palette sweeps across the whole row whatever its length.
  const shade = (i: number) => colors.ribbons[Math.round((i / (total - 1)) * (RIBBON_SHADES - 1))]!;
  // More waves in the band means each one a little fainter, so a full band still reads as light.
  const crowd = Math.min(1, 4 / lower) ** 0.5;
  for (let i = 0; layers.ribbons && i < lower; i++) {
    ribbon(
      ctx,
      scene,
      i,
      LOWER_BAND,
      lower,
      amp,
      seconds,
      glow,
      (0.18 + 0.46 * amp) * crowd * opacity,
      shade(i),
    );
  }
  for (let i = 0; layers.ribbons && i < upper; i++) {
    ribbon(
      ctx,
      scene,
      i + lower,
      UPPER_BAND,
      upper,
      amp * 0.7,
      seconds + 7,
      glow * 0.7,
      (0.1 + 0.24 * amp) * crowd * opacity,
      shade(i + lower),
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

  // The mist sits under everything drawn from here on, so bars and lines stay crisp over it.
  if (layers.mist && frame.mist) mist(ctx, scene, frame, k, amp, pulse, opacity);

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

  // The neon bars along the bottom, then the mirrored line wherever it was hung.
  if (layers.bars && frame.bars) bars(ctx, scene, frame, k, amp, pulse, opacity);
  if (layers.waveform && frame.waveform) waveform(ctx, scene, frame, k, amp, glow, opacity);

  // Shockwave: one ring rolling outward from a drop, gone within a second and a half.
  if (layers.shockwave && state.shockAge < SHOCK_SECONDS) {
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
