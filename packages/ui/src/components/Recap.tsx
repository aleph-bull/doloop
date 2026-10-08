import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { cn } from '../cn';
import { DataTable } from './Charts';
import { prefersStill } from './motion';

export { prefersStill };

/**
 * The recap's charts: hand-drawn SVG, so the radial clock and the gauge are as much at
 * home as the bars, and nothing needs a charting library. Every chart follows the same
 * rules: one series in the accent, several in the fixed `--chart-*` order, text in text
 * tokens, thin rounded marks on hairline grids, a tooltip on hover and on keyboard focus,
 * and a table view behind a "Show as a table" fold so no value is ever colour or hover only.
 * They draw in when scrolled into view, and not at all under reduced motion.
 */

/* ---------- motion ---------- */

/** Becomes true the first time the element scrolls into view, and stays true. */
export function useInView<T extends Element>(ref: RefObject<T | null>): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined' || prefersStill()) {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen]);
  return seen;
}

/* ---------- count up ---------- */

export interface CountUpProps {
  value: number;
  format: (v: number) => string;
  /** Milliseconds from zero to the value. */
  duration?: number;
  className?: string;
}

/** A number that counts up from zero when it comes into view. The final text is exact. */
export function CountUp({ value, format, duration = 1100, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref);
  const [shown, setShown] = useState(() => (prefersStill() ? value : 0));
  useEffect(() => {
    if (!seen) return;
    if (prefersStill()) {
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + (value - from) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [seen, value, duration]);
  return (
    <span ref={ref} className={className} aria-label={format(value)}>
      <span aria-hidden>{format(shown)}</span>
    </span>
  );
}

/* ---------- shared chrome ---------- */

interface Tip {
  x: number;
  y: number;
  text: string;
}

/** A figure with a floating tooltip and the table-view fold under it. */
function Figure({
  tip,
  children,
  table,
  className,
  figRef,
}: {
  tip: Tip | null;
  children: ReactNode;
  table?: { caption: string; columns: string[]; rows: Array<Array<string | number>> };
  className?: string;
  figRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <figure ref={figRef as RefObject<HTMLElement>} className={cn('rc-figure', className)}>
      <div className="rc-plot">
        {children}
        {tip && (
          <div className="rc-tip" style={{ left: `${tip.x}%`, top: `${tip.y}%` }} role="status">
            {tip.text}
          </div>
        )}
      </div>
      {table && table.rows.length > 0 && (
        <details className="rc-table">
          <summary>Show as a table</summary>
          <DataTable caption={table.caption} columns={table.columns} rows={table.rows} />
        </details>
      )}
    </figure>
  );
}

/** Hover and focus both show a mark's tooltip; leaving or blurring clears it. */
function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const bind = (x: number, y: number, text: string) => ({
    tabIndex: 0,
    onMouseEnter: () => setTip({ x, y, text }),
    onMouseLeave: () => setTip(null),
    onFocus: () => setTip({ x, y, text }),
    onBlur: () => setTip(null),
    'aria-label': text,
  });
  return { tip, bind };
}

/** Rounded top, square base: the 4px data-end the bars all share. */
function columnPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/* ---------- ring ---------- */

export interface RingProps {
  /** 0..1 */
  value: number;
  size?: number;
  stroke?: number;
  label: string;
  children?: ReactNode;
  className?: string;
}

/** A progress ring that fills when it scrolls into view. The label names it for readers. */
export function Ring({ value, size = 96, stroke = 9, label, children, className }: RingProps) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div
      ref={ref}
      className={cn('rc-ring', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
    >
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="rc-ring-track" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="rc-ring-fill"
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={seen ? c * (1 - v) : c}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {children && <div className="rc-ring-centre">{children}</div>}
    </div>
  );
}

/* ---------- gauge ---------- */

export interface GaugeProps {
  value: number;
  max: number;
  label: string;
  caption: ReactNode;
}

/** A half-circle meter: kept blocks against planned ones, say. */
export function Gauge({ value, max, label, caption }: GaugeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref);
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const r = 70;
  const len = Math.PI * r;
  return (
    <div ref={ref} className="rc-gauge" role="img" aria-label={label}>
      <svg viewBox="0 0 180 100" width="100%" aria-hidden>
        <path d={`M20,90 A${r},${r} 0 0 1 160,90`} className="rc-ring-track" strokeWidth={12} />
        <path
          d={`M20,90 A${r},${r} 0 0 1 160,90`}
          className="rc-ring-fill"
          strokeWidth={12}
          strokeDasharray={len}
          strokeDashoffset={seen ? len * (1 - ratio) : len}
        />
      </svg>
      <div className="rc-gauge-caption">{caption}</div>
    </div>
  );
}

/* ---------- sparkline ---------- */

export interface SparklineProps {
  values: number[];
  label: string;
  /** Highlights the last point, which is today. */
  width?: number;
  height?: number;
}

/** Seven days in a line: shape only, the last point marked. */
export function Sparkline({ values, label, width = 140, height = 36 }: SparklineProps) {
  const id = useId();
  const max = Math.max(1, ...values);
  const pad = 4;
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const pts = values.map((v, i) => [pad + i * step, height - pad - (v / max) * (height - pad * 2)]);
  const line = pts
    .map((p, i) => `${i ? 'L' : 'M'}${p[0]!.toFixed(1)},${p[1]!.toFixed(1)}`)
    .join('');
  const last = pts[pts.length - 1];
  return (
    <svg
      className="rc-spark"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {pts.length > 1 && (
        <path d={`${line}L${last![0]},${height}L${pts[0]![0]},${height}Z`} fill={`url(#${id})`} />
      )}
      <path d={line} className="rc-line" />
      {last && <circle cx={last[0]} cy={last[1]} r={4} className="rc-dot" />}
    </svg>
  );
}

/* ---------- week bars with ghosts ---------- */

export interface BarDay {
  label: string;
  /** The long form for tooltips and the table: "Tuesday, Sep 22". */
  full: string;
  minutes: number;
  previousMinutes: number | null;
  best: boolean;
  today: boolean;
  future: boolean;
}

export interface WeekBarsProps {
  days: BarDay[];
  fmt: (minutes: number) => string;
  /** "last week", "last month": what the ghost bars are. */
  ghostName: string;
  ariaLabel: string;
}

/** A column per day in the accent, the range before as faint ghosts behind, the best day named. */
export function WeekBars({ days, fmt, ghostName, ariaLabel }: WeekBarsProps) {
  const figRef = useRef<HTMLElement>(null);
  const seen = useInView(figRef);
  const { tip, bind } = useTip();
  const W = 640;
  const H = 220;
  const top = 26;
  const base = H - 26;
  const max = Math.max(30, ...days.map((d) => Math.max(d.minutes, d.previousMinutes ?? 0)));
  const slot = W / days.length;
  const bw = Math.min(24, slot * 0.46);
  const y = (m: number) => base - (m / max) * (base - top);
  const thin = days.length > 14;
  return (
    <Figure
      figRef={figRef}
      tip={tip}
      className={seen ? 'is-in' : undefined}
      table={{
        caption: ariaLabel,
        columns: ['Day', 'Studied', ghostName.replace(/^./, (c) => c.toUpperCase())],
        rows: days
          .filter((d) => !d.future)
          .map((d) => [
            d.full,
            fmt(d.minutes),
            d.previousMinutes === null ? '–' : fmt(d.previousMinutes),
          ]),
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel}>
        {[0.5, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={y(max * f)} y2={y(max * f)} className="rc-grid" />
        ))}
        <line x1={0} x2={W} y1={base} y2={base} className="rc-axis" />
        {days.map((d, i) => {
          const cx = slot * i + slot / 2;
          const gw = bw + 8;
          const h = base - y(d.minutes);
          const gh = d.previousMinutes ? base - y(d.previousMinutes) : 0;
          const text = `${d.full}: ${d.minutes > 0 ? fmt(d.minutes) : 'nothing yet'}${
            d.previousMinutes !== null ? ` · ${ghostName} ${fmt(d.previousMinutes)}` : ''
          }`;
          return (
            <g key={d.full}>
              {/* Only the marks grow in; the labels under them stay put. */}
              <g className="rc-col" style={{ '--i': i } as CSSProperties}>
                {gh > 0 && (
                  <path d={columnPath(cx - gw / 2, base - gh, gw, gh)} className="rc-ghost" />
                )}
                {h > 0 && (
                  <path
                    d={columnPath(cx - bw / 2, base - h, bw, h)}
                    className={cn('rc-bar', d.best && 'is-best')}
                  />
                )}
                {d.best && d.minutes > 0 && (
                  <text x={cx} y={base - h - 8} textAnchor="middle" className="rc-value">
                    {fmt(d.minutes)}
                  </text>
                )}
                {/* Anchors the group's box to the baseline, so it grows up from the axis. */}
                <rect x={cx} y={base} width={0} height={0} />
              </g>
              {(!thin || i % 5 === 0 || d.today) && (
                <text
                  x={cx}
                  y={H - 8}
                  textAnchor="middle"
                  className={cn('rc-tick', d.today && 'is-today', d.future && 'is-future')}
                >
                  {d.label}
                </text>
              )}
              <rect
                x={slot * i}
                y={top - 20}
                width={slot}
                height={base - top + 20}
                className="rc-hit"
                {...bind((cx / W) * 100, 8, text)}
              />
            </g>
          );
        })}
      </svg>
      <ul className="rc-legend" aria-hidden>
        <li>
          <span className="rc-swatch" style={{ background: 'var(--accent)' }} /> This{' '}
          {ghostName.replace('last ', '')}
        </li>
        <li>
          <span className="rc-swatch is-ghost" /> {ghostName.replace(/^./, (c) => c.toUpperCase())}
        </li>
      </ul>
    </Figure>
  );
}

/* ---------- radial clock ---------- */

export interface RadialClockProps {
  /** Minutes by hour, 0..23. */
  hours: number[];
  fmt: (minutes: number) => string;
  ariaLabel: string;
  children?: ReactNode;
}

const hourLabel = (h: number) =>
  h === 0 ? '12 am' : h < 12 ? `${h} am` : h === 12 ? '12 pm' : `${h - 12} pm`;

/** A 24-hour clock face with a spoke per hour, as long as the time started then. */
export function RadialClock({ hours, fmt, ariaLabel, children }: RadialClockProps) {
  const figRef = useRef<HTMLElement>(null);
  const seen = useInView(figRef);
  const { tip, bind } = useTip();
  const S = 260;
  const c = S / 2;
  const inner = 48;
  const outer = 112;
  const max = Math.max(1, ...hours);
  return (
    <Figure
      figRef={figRef}
      tip={tip}
      className={cn('rc-clock', seen && 'is-in')}
      table={{
        caption: ariaLabel,
        columns: ['Hour', 'Studied'],
        rows: hours.map((m, h) => [hourLabel(h), fmt(m)]).filter((r, h) => hours[h]! > 0),
      }}
    >
      <svg viewBox={`0 0 ${S} ${S}`} width="100%" role="img" aria-label={ariaLabel}>
        <circle cx={c} cy={c} r={inner} className="rc-grid-circle" />
        <circle cx={c} cy={c} r={outer} className="rc-grid-circle" />
        {hours.map((m, h) => {
          const a0 = ((h / 24) * 360 - 90 + 1.6) * (Math.PI / 180);
          const a1 = (((h + 1) / 24) * 360 - 90 - 1.6) * (Math.PI / 180);
          const r = inner + (m / max) * (outer - inner);
          const p = (rad: number, a: number) => `${c + rad * Math.cos(a)},${c + rad * Math.sin(a)}`;
          const mid = (a0 + a1) / 2;
          const tx = ((c + (outer + 4) * Math.cos(mid)) / S) * 100;
          const ty = ((c + (outer + 4) * Math.sin(mid)) / S) * 100;
          return (
            <g key={h} className="rc-spoke" style={{ '--i': h } as CSSProperties}>
              {m > 0 && (
                <path
                  d={`M${p(inner, a0)} L${p(r, a0)} A${r},${r} 0 0 1 ${p(r, a1)} L${p(inner, a1)} A${inner},${inner} 0 0 0 ${p(inner, a0)}Z`}
                  className="rc-wedge"
                />
              )}
              <path
                d={`M${p(inner, a0)} L${p(outer, a0)} A${outer},${outer} 0 0 1 ${p(outer, a1)} L${p(inner, a1)} A${inner},${inner} 0 0 0 ${p(inner, a0)}Z`}
                className="rc-hit"
                {...bind(tx, ty, `${hourLabel(h)}: ${m > 0 ? fmt(m) : 'nothing'}`)}
              />
            </g>
          );
        })}
        {[0, 6, 12, 18].map((h) => {
          const a = ((h / 24) * 360 - 90) * (Math.PI / 180);
          return (
            <text
              key={h}
              x={c + (outer + 14) * Math.cos(a)}
              y={c + (outer + 14) * Math.sin(a) + 4}
              textAnchor="middle"
              className="rc-tick"
            >
              {hourLabel(h).replace(' ', '')}
            </text>
          );
        })}
      </svg>
      {children && <div className="rc-clock-centre">{children}</div>}
    </Figure>
  );
}

/* ---------- donut ---------- */

export interface DonutSlice {
  key: string;
  label: string;
  minutes: number;
  /** A `--chart-N` slot, or -1 for the neutral (time with no course). */
  colorIndex: number;
}

export const seriesColor = (i: number) =>
  i < 0 ? 'var(--fg-subtle)' : `var(--chart-${(i % 5) + 1})`;

export interface DonutProps {
  slices: DonutSlice[];
  fmt: (minutes: number) => string;
  centre: ReactNode;
  ariaLabel: string;
}

/** Time per course around a ring, the total in the middle, a legend beside it. */
export function Donut({ slices, fmt, centre, ariaLabel }: DonutProps) {
  const figRef = useRef<HTMLElement>(null);
  const seen = useInView(figRef);
  const { tip, bind } = useTip();
  const total = slices.reduce((a, s) => a + s.minutes, 0);
  const S = 200;
  const c = S / 2;
  const r = 78;
  const w = 22;
  const gap = slices.length > 1 ? 0.025 : 0;
  // Where each slice starts and ends, as fractions of the ring, worked out before drawing.
  const spans = slices.map((_, i) => ({
    f0: slices.slice(0, i).reduce((a, x) => a + x.minutes, 0) / total,
    f1: slices.slice(0, i + 1).reduce((a, x) => a + x.minutes, 0) / total,
  }));
  return (
    <Figure
      figRef={figRef}
      tip={tip}
      className={cn('rc-donut', seen && 'is-in')}
      table={{
        caption: ariaLabel,
        columns: ['Course', 'Time', 'Share'],
        rows: slices.map((s) => [
          s.label,
          fmt(s.minutes),
          `${Math.round((s.minutes / total) * 100)}%`,
        ]),
      }}
    >
      <div className="rc-donut-body">
        <div className="rc-donut-chart">
          <svg viewBox={`0 0 ${S} ${S}`} width="100%" role="img" aria-label={ariaLabel}>
            {slices.map((s, i) => {
              const { f0, f1 } = spans[i]!;
              const a0 = (f0 + gap / 2) * 2 * Math.PI - Math.PI / 2;
              const a1 = Math.max(a0 + 0.001, (f1 - gap / 2) * 2 * Math.PI - Math.PI / 2);
              const large = a1 - a0 > Math.PI ? 1 : 0;
              const pt = (a: number) => `${c + r * Math.cos(a)},${c + r * Math.sin(a)}`;
              const d =
                slices.length === 1
                  ? `M${c},${c - r} A${r},${r} 0 1 1 ${c - 0.01},${c - r}`
                  : `M${pt(a0)} A${r},${r} 0 ${large} 1 ${pt(a1)}`;
              const mid = (a0 + a1) / 2;
              return (
                <path
                  key={s.key}
                  d={d}
                  className="rc-arc"
                  stroke={seriesColor(s.colorIndex)}
                  strokeWidth={w}
                  {...bind(
                    ((c + r * Math.cos(mid)) / S) * 100,
                    ((c + r * Math.sin(mid)) / S) * 100,
                    `${s.label}: ${fmt(s.minutes)}, ${Math.round((s.minutes / total) * 100)}%`,
                  )}
                />
              );
            })}
          </svg>
          <div className="rc-donut-centre">{centre}</div>
        </div>
        <ul className="rc-legend is-column">
          {slices.map((s) => (
            <li key={s.key}>
              <span className="rc-swatch" style={{ background: seriesColor(s.colorIndex) }} />
              <span className="truncate">{s.label}</span>
              <span className="rc-legend-value">{fmt(s.minutes)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Figure>
  );
}

/* ---------- stacked days ---------- */

export interface StackedDaysProps {
  days: Array<{ label: string; full: string; segments: Array<{ key: string; minutes: number }> }>;
  series: Array<{ key: string; label: string; colorIndex: number }>;
  fmt: (minutes: number) => string;
  ariaLabel: string;
}

/** What each day was made of: a column per day, a segment per course, 2px gaps between. */
export function StackedDays({ days, series, fmt, ariaLabel }: StackedDaysProps) {
  const figRef = useRef<HTMLElement>(null);
  const seen = useInView(figRef);
  const { tip, bind } = useTip();
  const W = 640;
  const H = 200;
  const top = 12;
  const base = H - 24;
  const totals = days.map((d) => d.segments.reduce((a, s) => a + s.minutes, 0));
  const max = Math.max(30, ...totals);
  const slot = W / days.length;
  const bw = Math.min(24, slot * 0.5);
  const scale = (m: number) => (m / max) * (base - top);
  const labelOf = (key: string) => series.find((s) => s.key === key)?.label ?? key;
  return (
    <Figure
      figRef={figRef}
      tip={tip}
      className={seen ? 'is-in' : undefined}
      table={{
        caption: ariaLabel,
        columns: ['Day', ...series.map((s) => s.label)],
        rows: days.map((d) => [
          d.full,
          ...series.map((s) => fmt(d.segments.find((x) => x.key === s.key)?.minutes ?? 0)),
        ]),
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel}>
        <line x1={0} x2={W} y1={base} y2={base} className="rc-axis" />
        {days.map((d, i) => {
          const cx = slot * i + slot / 2;
          let y = base;
          const segs = d.segments.filter((s) => s.minutes > 0);
          return (
            <g key={d.full}>
              <g className="rc-col" style={{ '--i': i } as CSSProperties}>
                <rect x={cx} y={base} width={0} height={0} />
                {segs.map((s, j) => {
                  const h = scale(s.minutes);
                  y -= h;
                  const last = j === segs.length - 1;
                  const color = seriesColor(series.find((x) => x.key === s.key)?.colorIndex ?? -1);
                  const drawH = Math.max(1, h - (j > 0 ? 2 : 0));
                  return (
                    <path
                      key={s.key}
                      d={
                        last
                          ? columnPath(cx - bw / 2, y, bw, drawH)
                          : `M${cx - bw / 2},${y}h${bw}v${drawH}h${-bw}Z`
                      }
                      fill={color}
                      {...bind(
                        (cx / W) * 100,
                        ((y + h / 2) / H) * 100,
                        `${d.full} · ${labelOf(s.key)}: ${fmt(s.minutes)}`,
                      )}
                    />
                  );
                })}
              </g>
              <text x={cx} y={H - 6} textAnchor="middle" className="rc-tick">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {series.length > 1 && (
        <ul className="rc-legend">
          {series.map((s) => (
            <li key={s.key}>
              <span className="rc-swatch" style={{ background: seriesColor(s.colorIndex) }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </Figure>
  );
}

/* ---------- the climb ---------- */

export interface ClimbProps {
  points: Array<{ date: string; minutes: number }>;
  milestones: Array<{ hours: number; date: string }>;
  fmtDate: (date: string) => string;
  ariaLabel: string;
}

/** Total hours over time, as one rising line, with a marker at each milestone passed. */
export function Climb({ points, milestones, fmtDate, ariaLabel }: ClimbProps) {
  const figRef = useRef<HTMLElement>(null);
  const seen = useInView(figRef);
  const { tip, bind } = useTip();
  const id = useId();
  const W = 640;
  const H = 200;
  const pad = { l: 36, r: 16, t: 16, b: 24 };
  if (points.length === 0) return null;
  const t0 = Date.parse(points[0]!.date);
  const t1 = Math.max(t0 + 86_400_000, Date.parse(points[points.length - 1]!.date));
  const maxH = Math.max(1, points[points.length - 1]!.minutes / 60);
  const x = (d: string) => pad.l + ((Date.parse(d) - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (m: number) => H - pad.b - (m / 60 / maxH) * (H - pad.t - pad.b);
  const line = points
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.minutes).toFixed(1)}`)
    .join('');
  const ticks = [0, maxH / 2, maxH].map((h) => Math.round(h));
  return (
    <Figure
      figRef={figRef}
      tip={tip}
      className={cn('rc-climb', seen && 'is-in')}
      table={{
        caption: ariaLabel,
        columns: ['Milestone', 'Reached'],
        rows: milestones.map((m) => [`${m.hours} hours`, fmtDate(m.date)]),
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel}>
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((h) => (
          <g key={h}>
            <line x1={pad.l} x2={W - pad.r} y1={y(h * 60)} y2={y(h * 60)} className="rc-grid" />
            <text x={pad.l - 8} y={y(h * 60) + 4} textAnchor="end" className="rc-tick">
              {h} h
            </text>
          </g>
        ))}
        <path
          d={`${line}L${x(points[points.length - 1]!.date)},${H - pad.b}L${x(points[0]!.date)},${H - pad.b}Z`}
          fill={`url(#${id})`}
          className="rc-area"
        />
        <path d={line} className="rc-line rc-draw" pathLength={1} />
        {milestones.map((m) => {
          const px = x(m.date);
          const py = y(m.hours * 60);
          return (
            <g key={m.hours}>
              <circle cx={px} cy={py} r={5} className="rc-dot" />
              {/* Beside the dot, not above it, so it never sits on the axis labels. */}
              <text x={px + 9} y={py + 14} className="rc-value">
                {m.hours} h
              </text>
              <circle
                cx={px}
                cy={py}
                r={14}
                className="rc-hit"
                {...bind((px / W) * 100, (py / H) * 100, `${m.hours} hours on ${fmtDate(m.date)}`)}
              />
            </g>
          );
        })}
        <text x={pad.l} y={H - 6} className="rc-tick">
          {fmtDate(points[0]!.date)}
        </text>
        <text x={W - pad.r} y={H - 6} textAnchor="end" className="rc-tick">
          {fmtDate(points[points.length - 1]!.date)}
        </text>
      </svg>
    </Figure>
  );
}

/* ---------- plain columns ---------- */

export interface ColumnsProps {
  bars: Array<{ label: string; value: number; highlight?: boolean }>;
  fmt: (v: number) => string;
  ariaLabel: string;
  columnName: string;
}

/** One series, one colour, the tallest named: for session lengths and weekdays. */
export function Columns({ bars, fmt, ariaLabel, columnName }: ColumnsProps) {
  const figRef = useRef<HTMLElement>(null);
  const seen = useInView(figRef);
  const { tip, bind } = useTip();
  const W = 400;
  const H = 180;
  const top = 22;
  const base = H - 26;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const slot = W / bars.length;
  const bw = Math.min(24, slot * 0.5);
  return (
    <Figure
      figRef={figRef}
      tip={tip}
      className={seen ? 'is-in' : undefined}
      table={{
        caption: ariaLabel,
        columns: [columnName, 'Value'],
        rows: bars.map((b) => [b.label, fmt(b.value)]),
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel}>
        <line x1={0} x2={W} y1={base} y2={base} className="rc-axis" />
        {bars.map((b, i) => {
          const cx = slot * i + slot / 2;
          const h = (b.value / max) * (base - top);
          return (
            <g key={b.label}>
              <g className="rc-col" style={{ '--i': i } as CSSProperties}>
                {h > 0 && (
                  <path
                    d={columnPath(cx - bw / 2, base - h, bw, h)}
                    className={cn('rc-bar', b.highlight && 'is-best')}
                  />
                )}
                {b.highlight && b.value > 0 && (
                  <text x={cx} y={base - h - 7} textAnchor="middle" className="rc-value">
                    {fmt(b.value)}
                  </text>
                )}
                <rect x={cx} y={base} width={0} height={0} />
              </g>
              <text x={cx} y={H - 8} textAnchor="middle" className="rc-tick">
                {b.label}
              </text>
              <rect
                x={slot * i}
                y={0}
                width={slot}
                height={base}
                className="rc-hit"
                {...bind((cx / W) * 100, 8, `${b.label}: ${fmt(b.value)}`)}
              />
            </g>
          );
        })}
      </svg>
    </Figure>
  );
}

/* ---------- the flame ---------- */

// The streak flame lives in its own file; it is exported from here with the other pieces.
export { Flame, streakLevel } from './StreakFlame';

/* ---------- skeleton ---------- */

/** A placeholder block with a slow shimmer, sized by its caller. */
export function SkeletonBlock({ style, className }: { style?: CSSProperties; className?: string }) {
  return <div className={cn('rc-skeleton', className)} style={style} aria-hidden />;
}
