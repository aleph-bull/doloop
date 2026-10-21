import { toLocalDate } from '@komogon/core';

/** "2 h 15 min", "45 min", "0 min" */
export function fmtMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined) return '–';
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  if (r === 0) return `${h} h`;
  return `${h} h ${r} min`;
}

/**
 * "9.5 h" for analytics-style copy, falling back to minutes under an hour so a short
 * history reads as "20 min" rather than the uninformative "0.3 h".
 */
export function fmtHours(min: number): string {
  if (min > 0 && min < 60) return `${Math.max(1, Math.round(min))} min`;
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

/**
 * Minutes needed per day, rounded up to five the way the daily plan rounds its suggestion,
 * so a task never says "26 min/day" beside a plan that asks for 30.
 */
export function fmtPerDay(min: number): string {
  return fmtMinutes(min > 0 ? Math.ceil(min / 5) * 5 : 0);
}

/** How long ago, short: "Just now", "5 min ago", "3 h ago", "2 d ago", then the date. */
export function fmtAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return 'Just now';
  const m = s / 60;
  if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)} h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.round(d)} d ago`;
  return fmtDate(iso, d > 365 ? { year: 'numeric' } : {});
}
