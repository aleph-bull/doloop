export type CalendarProvider = 'google' | 'outlook' | 'ics';

export interface AcademicEvent {
  id: string;
  title: string;
  description?: string;
  calendarId: string;
  calendarName: string;
  start: string;
  end: string;
  allDay: boolean;
  cancelled?: boolean;
  /** Marked as free time in its calendar: imported, but nothing is planned around it. */
  free?: boolean;
}

const assessment = /\b(?:mid[ -]?term|exam(?:ination)?|finals?|quiz|test)\b/i;
const deadline =
  /\b(?:due(?!\s+to\b)|deadline|assignment|homework|problem\s+set|submission|submit|essay|project|paper)\b/i;
const code = /\b([a-z]{2,8})[ -]?(\d{2,4}[a-z]?\d?)\b/gi;
const nonSubjects = /^(?:room|zoom|office|week|year|page|http|https)$/i;

export function courseKey(title: string): string {
  return title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** Deterministic recognition: no event text or calendar credentials leave the API. */
export function recognizeCalendarEvent(
  event: Pick<AcademicEvent, 'title' | 'description' | 'calendarName'>,
  courses: Array<{ id: string; title: string }>,
): { course: string | null; kind: 'assessment' | 'task' | null } {
  const text = `${event.title} ${event.description ?? ''}`.replace(/<[^>]*>/g, ' ');
  const sources = [event.title, event.calendarName, event.description ?? ''];
  let course: string | null = null;
  for (const source of sources) {
    const normalized = ` ${source.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
    const known = courses.filter((c) => {
      const title = c.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
      return (
        normalized.includes(` ${title} `) ||
        [...source.matchAll(code)].some((m) => courseKey(m[0]) === courseKey(c.title))
      );
    });
    if (known.length === 1) {
      course = known[0]!.title;
      break;
    }
    const codes = [...source.matchAll(code)].filter((m) => !nonSubjects.test(m[1]!));
    const distinct = [...new Set(codes.map((m) => `${m[1]}${m[2]}`.toUpperCase()))];
    if (distinct.length === 1) {
      course = distinct[0]!;
      break;
    }
    if (known.length > 1 || distinct.length > 1) break;
  }
  if (!course) {
    const namedClass = event.title.match(
      /^(.{2,80}?)\s*[-:|]\s*(?:lecture|tutorial|seminar|lab)\b/i,
    );
    if (namedClass) course = namedClass[1]!.trim();
  }
  return {
    course,
    kind: assessment.test(text) ? 'assessment' : deadline.test(text) ? 'task' : null,
  };
}
