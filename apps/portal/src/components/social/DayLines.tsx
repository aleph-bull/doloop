import { fmtDate } from '../../lib/format';

/** "1h 23m" / "45m", the way group and jam totals read. */
export function hm(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  return h === 0 ? `${m}m` : `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * Running totals over a run of days, one line per person: yours in the accent, the others
 * in greys. The line starts on the first day with its own value (no point at zero before
 * it) and ends on the last day, with a dot there. One day alone is a dot.
 */
export function DayLines({
  days,
  series,
  youId,
  label = 'Running totals by day, one line per person',
}: {
  days: string[];
  series: Array<{ id: string; values: number[] }>;
  youId: string;
  label?: string;
}) {
  const W = 320;
  const H = 150;
  const padL = 8;
  const padR = 12;
  const top = 10;
  const base = H - 22;
  const n = Math.max(1, days.length);
  const max = Math.max(30, ...series.flatMap((s) => s.values));
  const x = (i: number) => (n === 1 ? W / 2 : padL + ((W - padL - padR) * i) / (n - 1));
  const y = (v: number) => base - ((base - top) * v) / max;
  const path = (values: number[]) =>
    values
      .slice(0, n)
      .map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
      .join('');
  return (
    <svg className="group-lines" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line
          key={f}
          x1={padL}
          x2={W - padR}
          y1={y(max * f)}
          y2={y(max * f)}
          className="group-grid"
        />
      ))}
      {series.map((s, i) => {
        const you = s.id === youId;
        const lastIndex = Math.min(n, s.values.length) - 1;
        if (lastIndex < 0) return null;
        return (
          <g
            key={s.id}
            className={`group-line${you ? ' is-you' : ''}`}
            style={{ opacity: you ? 1 : Math.max(0.35, 0.85 - i * 0.12) }}
          >
            {n > 1 && <path d={path(s.values)} />}
            <circle cx={x(lastIndex)} cy={y(s.values[lastIndex] ?? 0)} r={3.5} />
          </g>
        );
      })}
      {days.map((d, i) => (
        <text key={d} x={x(i)} y={H - 6} className="group-axis" textAnchor="middle">
          {n > 7 ? fmtDate(d).split(' ')[1] : WEEKDAY[new Date(`${d}T12:00:00`).getDay()]}
        </text>
      ))}
    </svg>
  );
}
