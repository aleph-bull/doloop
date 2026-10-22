import type { RestReason } from '@komogon/core';
import { Check } from 'lucide-react';
import type { Deadline } from '../../lib/calendar';
import { restLabel } from '../../lib/calendar';
import { fmtMinutes } from '../../lib/format';
import { DueChip } from './TimeGrid';

export interface MonthGridProps {
  /** Whole weeks, Monday first, covering the month. */
  weeks: string[][];
  /** "2026-10": days outside it are drawn quieter. */
  month: string;
  today: string;
  deadlines: Map<string, Deadline[]>;
  minutes: Map<string, { planned: number; studied: number }>;
  rest: Map<string, RestReason>;
  onPickDay: (day: string) => void;
  onOpenDeadline: (d: Deadline) => void;
}

const MAX_CHIPS = 3;

export function MonthGrid({
  weeks,
  month,
  today,
  deadlines,
  minutes,
  rest,
  onPickDay,
  onOpenDeadline,
}: MonthGridProps) {
  const names = weeks[0]!.map((d) =>
    new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(`${d}T12:00:00`)),
  );
  return (
    <div className="cal-month">
      <div className="cal-month-names" aria-hidden>
        {names.map((n) => (
          <span key={n}>{n}</span>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0]} className="cal-month-row">
          {week.map((d) => {
            const due = deadlines.get(d) ?? [];
            const m = minutes.get(d);
            const label = restLabel(rest.get(d) ?? null);
            const outside = !d.startsWith(month);
            const past = d < today;
            const date = new Date(`${d}T12:00:00`);
            return (
              <div
                key={d}
                className={`cal-mday${d === today ? ' is-today' : ''}${outside ? ' is-outside' : ''}${label ? ' is-rest' : ''}`}
              >
                <button
                  type="button"
                  className="cal-mday-open"
                  aria-label={`Open the week of ${new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(date)}`}
                  onClick={() => onPickDay(d)}
                />
                <div className="cal-mday-top">
                  <span className="cal-mday-num tabular">{date.getDate()}</span>
                  {label && <span className="cal-mday-rest">{label}</span>}
                </div>
                <div className="cal-mday-due">
                  {due.slice(0, MAX_CHIPS).map((dl) => (
                    <DueChip key={dl.node.id} d={dl} onOpen={onOpenDeadline} />
                  ))}
                  {due.length > MAX_CHIPS && (
                    <span className="cal-due-more">{due.length - MAX_CHIPS} more</span>
                  )}
                </div>
                {/* Days gone by show what was studied; days ahead what is planned; today both. */}
                {m && (m.studied >= 1 || m.planned >= 1) && (
                  <div className="cal-mday-time tabular">
                    {m.studied >= 1 && d <= today && (
                      <span>
                        <Check size={11} aria-hidden /> {fmtMinutes(m.studied)}
                      </span>
                    )}
                    {m.planned >= 1 && !past && <span>{fmtMinutes(m.planned)} planned</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
