import { useId } from 'react';

/**
 * A contribution grid: one square per day, columns are weeks, rows are weekdays.
 * Five steps only — absent plus four filled — because a continuous ramp is not
 * distinguishable at 11px. Colour is never the only carrier: every square has a
 * title, and the accompanying table view holds the same numbers as text.
 */

export interface HeatmapDay {
  date: string;
  /** Study minutes, or a tracker's own unit when `format` is supplied. */
  minutes: number;
  level: 0 | 1 | 2 | 3 | 4;
  future: boolean;
}

export interface HeatmapProps {
  /** Columns of seven days, Monday first. */
  weeks: HeatmapDay[][];
  monthLabels: Array<{ column: number; label: string }>;
  ariaLabel: string;
  /** Thresholds behind levels 1-3, for the legend tooltip. */
  thresholds?: [number, number, number];
  /**
   * How a day's value reads in a tooltip. Defaults to study time ("1.5 h"); a tracker
   * passes its own unit ("12 pages") so the same grid serves anything countable.
   */
  format?: (value: number) => string;
  /** Smaller cells for a board of several grids side by side. */
  compact?: boolean;
  onSelect?: (day: HeatmapDay) => void;
}

const ROW_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];
const LABEL_W = 26;
const LABEL_H = 14;

function fmt(minutes: number): string {
  if (minutes <= 0) return 'no study';
  // A day with any work at all never reads as "0 min".
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  const h = minutes / 60;
  return `${h % 1 === 0 ? h : h.toFixed(1)} h`;
}

function pretty(date: string): string {
  // The date is already a calendar day; noon avoids any timezone rollover on parse.
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function Heatmap({
  weeks,
  monthLabels,
  ariaLabel,
  thresholds,
  format = fmt,
  compact = false,
  onSelect,
}: HeatmapProps) {
  const id = useId();
  const cell = compact ? 9 : 11;
  const step = cell + (compact ? 2 : 3);
  const width = LABEL_W + weeks.length * step;
  const height = LABEL_H + 7 * step;
  const labelFor = new Map(monthLabels.map((m) => [m.column, m.label]));

  return (
    <figure className="chart heatmap">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        width="100%"
        style={{ maxWidth: width, minWidth: Math.min(width, compact ? 420 : 560) }}
      >
        {weeks.map((_, col) =>
          labelFor.has(col) ? (
            <text
              key={`m-${col}`}
              x={LABEL_W + col * step}
              y={10}
              className="chart-label heatmap-axis"
            >
              {labelFor.get(col)}
            </text>
          ) : null,
        )}
        {ROW_LABELS.map((label, row) =>
          label ? (
            <text
              key={`r-${row}`}
              x={LABEL_W - 6}
              y={LABEL_H + row * step + cell - 2}
              textAnchor="end"
              className="chart-label heatmap-axis"
            >
              {label}
            </text>
          ) : null,
        )}
        {weeks.map((week, col) =>
          week.map((day, row) => (
            <rect
              key={`${id}-${day.date}`}
              x={LABEL_W + col * step}
              y={LABEL_H + row * step}
              width={cell}
              height={cell}
              rx={2.5}
              className={`heatmap-cell heatmap-l${day.future ? 'f' : day.level}`}
              tabIndex={onSelect && !day.future ? 0 : undefined}
              role={onSelect && !day.future ? 'button' : undefined}
              onClick={onSelect && !day.future ? () => onSelect(day) : undefined}
              onKeyDown={
                onSelect && !day.future
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelect(day);
                      }
                    }
                  : undefined
              }
            >
              <title>
                {day.future
                  ? `${pretty(day.date)}: upcoming`
                  : `${pretty(day.date)}: ${format(day.minutes)}`}
              </title>
            </rect>
          )),
        )}
      </svg>
      <div className="heatmap-legend">
        <span className="chart-label">Less</span>
        {([0, 1, 2, 3, 4] as const).map((l) => (
          <span
            key={l}
            className={`heatmap-swatch heatmap-l${l}`}
            aria-hidden
            title={
              thresholds && l > 0
                ? l === 4
                  ? `${format(thresholds[2])} or more`
                  : `under ${format(thresholds[l - 1]!)}`
                : undefined
            }
          />
        ))}
        <span className="chart-label">More</span>
      </div>
    </figure>
  );
}
