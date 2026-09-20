import { useId, useState } from 'react';

/**
 * Dependency-free SVG charts that follow the dataviz rules: thin marks, one axis,
 * fixed categorical order, direct labels + legend, tooltips, text in text tokens.
 * Colours: `--chart-1..5` (validated categorical palette) with a single-hue default.
 */

export const CHART_SERIES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

function fmt(n: number, unit: string): string {
  if (unit === 'h') return `${(n / 60) % 1 === 0 ? n / 60 : (n / 60).toFixed(1)} h`;
  if (unit === '%') return `${Math.round(n)}%`;
  return `${Math.round(n * 10) / 10}${unit}`;
}

/* ---------- Stacked horizontal bars ---------- */

export interface StackedRow {
  label: string;
  /** Ordered segments; the order is the legend order. */
  segments: Array<{ name: string; value: number }>;
}

export interface StackedBarsProps {
  rows: StackedRow[];
  /** Unit for labels: 'h' (input minutes), '%', or a suffix. */
  unit?: string;
  ariaLabel: string;
  /** Series names in fixed order (drives colour assignment). */
  series: string[];
}

export function StackedBars({ rows, unit = 'h', ariaLabel, series }: StackedBarsProps) {
  const [hover, setHover] = useState<{ row: number; seg: number } | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.segments.reduce((a, s) => a + s.value, 0)));
  const labelW = 120;
  const width = 640;
  const rowH = 28;
  const height = rows.length * rowH + 8;
  const plotW = width - labelW - 60;
  const colorOf = (name: string) =>
    CHART_SERIES[Math.max(0, series.indexOf(name)) % CHART_SERIES.length];
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} width="100%">
        {rows.map((r, i) => {
          let x = labelW;
          const total = r.segments.reduce((a, s) => a + s.value, 0);
          return (
            <g key={r.label} transform={`translate(0, ${i * rowH})`}>
              <text x={labelW - 10} y={rowH / 2 + 4} textAnchor="end" className="chart-label">
                {r.label.length > 16 ? `${r.label.slice(0, 15)}…` : r.label}
              </text>
              {r.segments.map((s, j) => {
                const w = (s.value / max) * plotW;
                const el = (
                  <rect
                    key={s.name}
                    x={x}
                    y={6}
                    width={Math.max(0, w - 2)}
                    height={rowH - 12}
                    rx={3}
                    fill={colorOf(s.name)}
                    opacity={hover && (hover.row !== i || hover.seg !== j) ? 0.55 : 1}
                    onMouseEnter={() => setHover({ row: i, seg: j })}
                    onMouseLeave={() => setHover(null)}
                  >
                    <title>{`${r.label} · ${s.name}: ${fmt(s.value, unit)}`}</title>
                  </rect>
                );
                x += w;
                return s.value > 0 ? el : null;
              })}
              {total > 0 && (
                <text x={x + 6} y={rowH / 2 + 4} className="chart-value">
                  {fmt(total, unit)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {series.length > 1 && (
        <ul className="chart-legend" aria-label="Legend">
          {series.map((s) => (
            <li key={s}>
              <span className="chart-swatch" style={{ background: colorOf(s) }} aria-hidden /> {s}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

/* ---------- Line chart (single series) ---------- */

export interface LinePoint {
  x: string; // label
  y: number;
}

export interface LineChartProps {
  points: LinePoint[];
  min?: number;
  max?: number;
  ariaLabel: string;
  unit?: string;
}

export function LineChart({ points, min = 0, max, ariaLabel, unit = '' }: LineChartProps) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const height = 200;
  const pad = { l: 36, r: 16, t: 16, b: 28 };
  const hi = max ?? Math.max(1, ...points.map((p) => p.y));
  const sx = (i: number) =>
    pad.l +
    (points.length > 1
      ? (i / (points.length - 1)) * (width - pad.l - pad.r)
      : (width - pad.l - pad.r) / 2);
  const sy = (v: number) => pad.t + (1 - (v - min) / (hi - min || 1)) * (height - pad.t - pad.b);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i)},${sy(p.y)}`).join(' ');
  const ticks = [min, (min + hi) / 2, hi];
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} width="100%">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={sy(t)} y2={sy(t)} className="chart-grid" />
            <text x={pad.l - 8} y={sy(t) + 4} textAnchor="end" className="chart-label">
              {fmt(t, unit)}
            </text>
          </g>
        ))}
        {points.length > 0 && (
          <path d={d} fill="none" stroke="var(--chart-1)" strokeWidth={2} strokeLinejoin="round" />
        )}
        {points.map((p, i) => (
          <g key={`${id}-${i}`}>
            <circle
              cx={sx(i)}
              cy={sy(p.y)}
              r={hover === i ? 6 : 4}
              fill="var(--chart-1)"
              stroke="var(--panel-fill)"
              strokeWidth={2}
            />
            <rect
              x={sx(i) - 14}
              y={pad.t}
              width={28}
              height={height - pad.t - pad.b}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${p.x}: ${fmt(p.y, unit)}`}</title>
            </rect>
            {(i === 0 || i === points.length - 1 || points.length <= 8) && (
              <text x={sx(i)} y={height - 8} textAnchor="middle" className="chart-label">
                {p.x}
              </text>
            )}
            {hover === i && (
              <text x={sx(i)} y={sy(p.y) - 10} textAnchor="middle" className="chart-value">
                {fmt(p.y, unit)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </figure>
  );
}

/* ---------- Vertical bars (single series, e.g. hours by day, histogram) ---------- */

export interface BarsProps {
  bars: Array<{ label: string; value: number; highlight?: boolean }>;
  ariaLabel: string;
  unit?: string;
}

export function Bars({ bars, ariaLabel, unit = 'h' }: BarsProps) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const height = 180;
  const pad = { l: 8, r: 8, t: 20, b: 26 };
  const max = Math.max(1, ...bars.map((b) => b.value));
  const gap = 8;
  const bw = (width - pad.l - pad.r - gap * (bars.length - 1)) / Math.max(1, bars.length);
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} width="100%">
        <line
          x1={pad.l}
          x2={width - pad.r}
          y1={height - pad.b}
          y2={height - pad.b}
          className="chart-grid"
        />
        {bars.map((b, i) => {
          const h = (b.value / max) * (height - pad.t - pad.b);
          const x = pad.l + i * (bw + gap);
          const y = height - pad.b - h;
          return (
            <g key={b.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={pad.t} width={bw} height={height - pad.t - pad.b} fill="transparent">
                <title>{`${b.label}: ${fmt(b.value, unit)}`}</title>
              </rect>
              {b.value > 0 && (
                <rect
                  x={x}
                  y={y}
                  width={bw}
                  height={h}
                  rx={3}
                  fill={b.highlight ? 'var(--chart-2)' : 'var(--chart-1)'}
                  opacity={hover !== null && hover !== i ? 0.55 : 1}
                />
              )}
              {(hover === i || b.highlight) && b.value > 0 && (
                <text x={x + bw / 2} y={y - 6} textAnchor="middle" className="chart-value">
                  {fmt(b.value, unit)}
                </text>
              )}
              <text x={x + bw / 2} y={height - 8} textAnchor="middle" className="chart-label">
                {b.label}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/* ---------- Table view (accessibility) ---------- */

export function DataTable({
  columns,
  rows,
  caption,
}: {
  columns: string[];
  rows: Array<Array<string | number>>;
  caption: string;
}) {
  return (
    <table className="chart-table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} className={typeof c === 'number' ? 'tabular' : undefined}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
