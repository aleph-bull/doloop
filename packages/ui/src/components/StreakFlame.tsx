import { useId, type CSSProperties } from 'react';
import { cn } from '../cn';
import { prefersStill } from './motion';

/**
 * The streak flame, drawn like hand-animated fire: a round, white-hot bulb at the bottom
 * that narrows into a thin tongue whose tip leans and hooks, in three layers (deep red,
 * orange, yellow) that each morph through their own poses at their own speed, inside a
 * soft dark-red halo. Small tongues break off the top and drift up and away, and sparks
 * rise out of it. Nothing ever lines up, so the fire never visibly loops.
 *
 * It grows with the streak: nothing lit at 0, a small low flame at first, then taller,
 * livelier and brighter, with more pieces breaking away, until past a month it roars.
 *
 * The motion is SVG's own animation (morphing a path is not something CSS can do). Under
 * reduced motion the animations are left out and the flame is drawn still.
 */

type Point = readonly [number, number];

interface Pose {
  /** How far the tongue leans sideways, and how far the tip hooks past that. */
  lean: number;
  curl: number;
  /** Height and half-width of the bulb, in viewBox units. */
  h: number;
  w: number;
}

const CX = 32;
const BASE = 74;

const fmt = (p: Point) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

/**
 * One flame as a closed path: a wide round bulb, a waist on each side, and a thin tip that
 * hooks over. Every pose uses the same six curves, so any two poses morph into each other.
 */
function tongue({ lean, curl, h, w }: Pose, x = CX, y = BASE): string {
  const bottom: Point = [x, y];
  const leftBelly: Point = [x - w, y - h * 0.3];
  const leftWaist: Point = [x - w * 0.42 + lean * 0.55, y - h * 0.64];
  const tip: Point = [x + lean + curl, y - h];
  const rightWaist: Point = [x + w * 0.36 + lean * 0.75, y - h * 0.6];
  const rightBelly: Point = [x + w, y - h * 0.28];
  return [
    `M${fmt(bottom)}`,
    `C${fmt([x - w * 0.72, y])} ${fmt([x - w, y - h * 0.1])} ${fmt(leftBelly)}`,
    `C${fmt([x - w, y - h * 0.46])} ${fmt([leftWaist[0] - w * 0.22, y - h * 0.52])} ${fmt(leftWaist)}`,
    `C${fmt([leftWaist[0] + w * 0.16, y - h * 0.78])} ${fmt([tip[0] - w * 0.2 - curl * 0.45, y - h * 0.92])} ${fmt(tip)}`,
    `C${fmt([tip[0] - w * 0.06 - curl * 0.1, y - h * 0.86])} ${fmt([rightWaist[0] + w * 0.08, y - h * 0.76])} ${fmt(rightWaist)}`,
    `C${fmt([rightWaist[0] + w * 0.24, y - h * 0.48])} ${fmt([x + w, y - h * 0.44])} ${fmt(rightBelly)}`,
    `C${fmt([x + w, y - h * 0.1])} ${fmt([x + w * 0.72, y])} ${fmt(bottom)}`,
    'Z',
  ].join(' ');
}

/** A layer's poses: the loop goes through them and back to the first. */
function poses(h: number, w: number, lean: number, sway: number, x = CX, y = BASE): string[] {
  const set: Pose[] = [
    { lean: lean - sway * 0.7, curl: sway * 1.1, h, w },
    { lean: lean + sway * 0.6, curl: -sway * 0.9, h: h * 1.1, w: w * 0.93 },
    { lean: lean - sway * 0.25, curl: sway * 1.5, h: h * 0.93, w: w * 1.05 },
    { lean: lean + sway * 0.9, curl: sway * 0.5, h: h * 1.05, w: w * 0.97 },
    { lean: lean - sway * 0.5, curl: -sway * 0.4, h: h * 0.98, w },
  ];
  return [...set, set[0]!].map((p) => tongue(p, x, y));
}

interface Tuning {
  /** Height of the outer flame, viewBox units (the box is 80 tall). */
  height: number;
  sway: number;
  /** Seconds for the outer loop; the inner layers run faster. */
  speed: number;
  /** Pieces that break off the top and drift away. */
  wisps: number;
  sparks: number;
  glow: number;
}

const LEVELS: Record<1 | 2 | 3 | 4 | 5, Tuning> = {
  1: { height: 36, sway: 3, speed: 2.2, wisps: 1, sparks: 0, glow: 0.4 },
  2: { height: 44, sway: 4, speed: 2, wisps: 1, sparks: 1, glow: 0.5 },
  3: { height: 52, sway: 5, speed: 1.8, wisps: 2, sparks: 2, glow: 0.6 },
  4: { height: 60, sway: 6, speed: 1.6, wisps: 2, sparks: 3, glow: 0.72 },
  5: { height: 68, sway: 7, speed: 1.4, wisps: 3, sparks: 4, glow: 0.85 },
};

export function streakLevel(days: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (days <= 0) return 0;
  if (days < 3) return 1;
  if (days < 7) return 2;
  if (days < 14) return 3;
  if (days < 30) return 4;
  return 5;
}

const ease = (n: number) => Array.from({ length: n }, () => '0.45 0 0.55 1').join(';');
const times = (n: number) => Array.from({ length: n + 1 }, (_, i) => (i / n).toFixed(3)).join(';');

/** Morph `d` through the poses, eased, forever. */
function Morph({ values, dur, begin = 0 }: { values: string[]; dur: number; begin?: number }) {
  const n = values.length - 1;
  return (
    <animate
      attributeName="d"
      dur={`${dur}s`}
      begin={`${-begin}s`}
      repeatCount="indefinite"
      values={values.join(';')}
      calcMode="spline"
      keyTimes={times(n)}
      keySplines={ease(n)}
    />
  );
}

/** A flame that grows, brightens and throws off more of itself as the streak lengthens. */
export function Flame({ days, size = 56 }: { days: number; size?: number }) {
  const uid = useId().replace(/:/g, '');
  const level = streakLevel(days);
  const still = prefersStill() || level === 0;
  const t = level === 0 ? LEVELS[2] : LEVELS[level];
  const h = t.height;
  const id = (name: string) => `${uid}-${name}`;
  const top = BASE - h;

  const outer = poses(h, h * 0.34, 0, t.sway);
  const middle = poses(h * 0.78, h * 0.28, 0.6, t.sway * 0.8);
  const inner = poses(h * 0.52, h * 0.21, 0.9, t.sway * 0.55);

  return (
    <span
      className={cn('rc-flame', `is-level-${level}`)}
      style={{ width: size, height: size } as CSSProperties}
      aria-hidden
    >
      <svg viewBox="0 0 64 80" width={size} height={size} overflow="visible">
        <defs>
          <radialGradient id={id('glow')} cx="50%" cy="68%" r="50%">
            <stop offset="0" stopColor="#ff6a1a" stopOpacity={t.glow} />
            <stop offset="0.5" stopColor="#d9281c" stopOpacity={t.glow * 0.35} />
            <stop offset="1" stopColor="#8c1414" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={id('outer')} x1="0" x2="0" y1="1" y2="0">
            <stop offset="0" stopColor="#ff6320" />
            <stop offset="0.55" stopColor="#ee3f1c" />
            <stop offset="1" stopColor="#b3221a" />
          </linearGradient>
          <linearGradient id={id('middle')} x1="0" x2="0" y1="1" y2="0">
            <stop offset="0" stopColor="#ffc23a" />
            <stop offset="1" stopColor="#ff7417" />
          </linearGradient>
          <linearGradient id={id('inner')} x1="0" x2="0" y1="1" y2="0">
            <stop offset="0" stopColor="#fffbe0" />
            <stop offset="0.45" stopColor="#fff07a" />
            <stop offset="1" stopColor="#ffcf3d" />
          </linearGradient>
          <radialGradient id={id('base')} cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="1" stopColor="#fff6cc" stopOpacity="0" />
          </radialGradient>
          <filter id={id('soft')} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
        </defs>

        {/* The glow the fire throws on everything around it. */}
        <ellipse
          cx={CX}
          cy={BASE - h * 0.32}
          rx={h * 0.66}
          ry={h * 0.72}
          fill={`url(#${id('glow')})`}
        >
          {!still && (
            <animate
              attributeName="opacity"
              values="0.7;1;0.8;0.95;0.7"
              dur={`${t.speed * 1.3}s`}
              repeatCount="indefinite"
            />
          )}
        </ellipse>

        {/* A soft dark-red halo, the same shape as the flame, a little larger and blurred. */}
        <g transform={`translate(${CX} ${BASE}) scale(1.16 1.1) translate(${-CX} ${-BASE})`}>
          <path d={outer[0]} fill="#a3171a" opacity="0.55" filter={`url(#${id('soft')})`}>
            {!still && <Morph values={outer} dur={t.speed} />}
          </path>
        </g>

        {/*
          Pieces of flame that break off the tip, rise and shrink to nothing. They shrink rather
          than fade: a half-transparent orange over the dark reads as brown, not as fire. Each
          is drawn around its own centre so it shrinks in place while it drifts.
        */}
        {!still &&
          Array.from({ length: t.wisps }, (_, i) => {
            const dur = t.speed * (1.25 + i * 0.35);
            const side = i % 2 ? 1 : -1;
            const wh = h * (0.24 - i * 0.03);
            const shapes = poses(wh, wh * 0.36, side * 1.2, t.sway * 0.45, 0, wh / 2);
            const x0 = CX + side * (1.5 + i);
            const y0 = top + wh * 0.6;
            const begin = `${(i * dur) / 2}s`;
            return (
              <g key={`w${i}`} opacity="0" transform={`translate(${x0} ${y0})`}>
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  values={`${x0} ${y0 + h * 0.1}; ${x0 + side * 3} ${y0 - h * 0.14}; ${x0 + side * 7} ${y0 - h * 0.38}`}
                  keyTimes="0;0.5;1"
                  dur={`${dur}s`}
                  begin={begin}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0;1;1;0"
                  keyTimes="0;0.08;0.85;1"
                  dur={`${dur}s`}
                  begin={begin}
                  repeatCount="indefinite"
                />
                <g>
                  <animateTransform
                    attributeName="transform"
                    type="scale"
                    values="1;0.8;0.05"
                    keyTimes="0;0.4;1"
                    dur={`${dur}s`}
                    begin={begin}
                    repeatCount="indefinite"
                  />
                  <path d={shapes[0]} fill={`url(#${id('middle')})`}>
                    <Morph values={shapes} dur={dur * 0.7} begin={i * 0.3} />
                  </path>
                </g>
              </g>
            );
          })}

        <path d={outer[0]} fill={`url(#${id('outer')})`}>
          {!still && <Morph values={outer} dur={t.speed} />}
        </path>
        <path d={middle[0]} fill={`url(#${id('middle')})`}>
          {!still && <Morph values={middle} dur={t.speed * 0.8} begin={0.4} />}
        </path>
        <path d={inner[0]} fill={`url(#${id('inner')})`}>
          {!still && <Morph values={inner} dur={t.speed * 0.64} begin={0.2} />}
        </path>

        {/* The white-hot bulb at the bottom. */}
        <ellipse
          cx={CX + 0.6}
          cy={BASE - h * 0.13}
          rx={h * 0.19}
          ry={h * 0.11}
          fill={`url(#${id('base')})`}
        >
          {!still && (
            <animate
              attributeName="rx"
              values={`${h * 0.19};${h * 0.22};${h * 0.18};${h * 0.19}`}
              dur={`${t.speed * 0.9}s`}
              repeatCount="indefinite"
            />
          )}
        </ellipse>

        {/* Sparks rising out of it. */}
        {!still &&
          Array.from({ length: t.sparks }, (_, i) => {
            const dur = t.speed * (1.1 + i * 0.27);
            const x = CX + (i % 2 ? 4 : -3) + i * 0.6;
            const drift = i % 2 ? 8 : -7;
            const begin = `${(i * dur) / Math.max(1, t.sparks)}s`;
            return (
              <circle
                key={`s${i}`}
                cx={x}
                cy={top + 12}
                r={1.5 - i * 0.15}
                fill="#ffd166"
                opacity="0"
              >
                <animate
                  attributeName="cy"
                  values={`${top + 14};${top - 16}`}
                  dur={`${dur}s`}
                  begin={begin}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="cx"
                  values={`${x};${x + drift * 0.35};${x + drift}`}
                  dur={`${dur}s`}
                  begin={begin}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0;1;0.8;0"
                  keyTimes="0;0.15;0.6;1"
                  dur={`${dur}s`}
                  begin={begin}
                  repeatCount="indefinite"
                />
              </circle>
            );
          })}
      </svg>
    </span>
  );
}
