import { toLocalDate } from '@doloop/core';

/** "2 h 15 m", "45 m", "0 m" */
export function fmtMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined) return '–';
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} m`;
  if (r === 0) return `${h} h`;
  return `${h} h ${r} m`;
}

/** "9.5 h" for analytics-style copy. */
export function fmtHours(min: number): string {
  const h = min / 60;
  return `${h % 1 === 0 ? h : h.toFixed(1)} h`;
}

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function fmtDate(
  iso: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', ...opts }).format(
    new Date(iso),
  );
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );
}

/** Relative due copy: "due today", "due tomorrow", "due in 4 days", "3 days overdue". */
export function fmtDue(dueAt: string | null, now = new Date()): string {
  if (!dueAt) return 'No due date';
  const today = toLocalDate(now, tz());
  const due = toLocalDate(dueAt, tz());
  const days = Math.round((Date.parse(due) - Date.parse(today)) / 86_400_000);
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days > 1 && days < 14) return `Due in ${days} days`;
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} overdue`;
  return `Due ${fmtDate(dueAt)}`;
}

/** Convert a date input (YYYY-MM-DD) + time (HH:MM) in the local zone to ISO. */
export function localToIso(date: string, time = '23:59'): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

/** ISO -> local YYYY-MM-DD for date inputs. */
export function isoToLocalDate(iso: string | null): string {
  if (!iso) return '';
  return toLocalDate(iso, tz());
}

export function isoToLocalTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function pct(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined) return '';
  return `${Math.round(ratio * 100)}%`;
}
