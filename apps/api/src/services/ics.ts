import type { PlannedBlock, Session, StudyNode } from '@komogon/core';

function icsDate(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** YYYYMMDD in the user's timezone: an all-day event for the day the deadline falls on. */
function icsDay(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date(iso))
    .replace(/-/g, '');
}

function esc(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function fold(line: string): string {
  // RFC 5545: lines longer than 75 octets are folded with CRLF + space.
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

export interface IcsInput {
  blocks: PlannedBlock[];
  nodes: StudyNode[];
  /** Optional past sessions to include as events. */
  sessions?: Session[];
  /** Names routine sessions, which have no node. */
  routines?: Array<{ id: string; title: string }>;
  calendarName?: string;
  now: string;
  /** For the all-day due-date events. Defaults to UTC. */
  timezone?: string;
}

/** Build an iCalendar feed of planned blocks (and optionally completed sessions). */
export function buildIcs(input: IcsInput): string {
  const titleOf = (id: string | null) =>
    id ? (input.nodes.find((n) => n.id === id)?.title ?? 'Study') : 'Study';
  const routineTitleOf = (id: string) =>
    input.routines?.find((r) => r.id === id)?.title ?? 'a routine';
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Komodon//Study planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(input.calendarName ?? 'Komodon study plan')}`,
  ];
  const stamp = icsDate(input.now);
  for (const b of input.blocks) {
    if (b.cancelled) continue;
    // Only study the user planned here. Commitments came from their calendar in the first
    // place - handing them back would be an echo, and with a subscribed feed, a loop.
    // Sessions are published from the session list below, so they are not duplicated here.
    if (b.source !== 'app') continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:block-${b.id}@komogon`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(b.startAt)}`,
      `DTEND:${icsDate(b.endAt)}`,
      `SUMMARY:${esc(`Study: ${titleOf(b.nodeId)}`)}`,
      'DESCRIPTION:Planned in Komodon',
      'END:VEVENT',
    );
  }
  // Due dates set on tasks and assessments, as all-day events on the day they fall.
  for (const n of input.nodes) {
    if (!n.dueAt || n.archived) continue;
    const day = icsDay(n.dueAt, input.timezone ?? 'UTC');
    lines.push(
      'BEGIN:VEVENT',
      `UID:due-${n.id}@komogon`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day}`,
      `SUMMARY:${esc(`${n.kind === 'assessment' ? '' : 'Due: '}${n.title}`)}`,
      `DESCRIPTION:${esc(n.completedAt ? 'Done (Komodon)' : 'Due date set in Komodon')}`,
      'END:VEVENT',
    );
  }
  for (const s of input.sessions ?? []) {
    if (!s.endedAt) continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:session-${s.id}@komogon`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(s.startedAt)}`,
      `DTEND:${icsDate(s.endedAt)}`,
      `SUMMARY:${esc(`Studied: ${s.routineId ? routineTitleOf(s.routineId) : titleOf(s.nodeId)}`)}`,
      `DESCRIPTION:${esc(`${Math.round(s.workSeconds / 60)} min of focused work`)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
