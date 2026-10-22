import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgliteDb } from '../db/client';
import { calendarFeeds, nodes, plannedBlocks } from '../db/schema';
import { buildServer } from '../server';
import { createHsVerifier, signDevToken } from '../auth/verify';
import { FeedError, isBlockedAddress, normalizeFeedUrl } from '../services/calendar-feeds';
import { TEST_SECRET, USER_A, USER_B } from './helpers';

let app: Awaited<ReturnType<typeof buildServer>>;
let pg: Awaited<ReturnType<typeof createPgliteDb>>;
let token: string, tokenB: string;
const fetched: string[] = [];

const timetable = (extra: string[] = []) =>
  [
    'BEGIN:VCALENDAR',
    'X-WR-CALNAME:Fall timetable',
    'BEGIN:VEVENT',
    'UID:lec',
    'SUMMARY:MAT137 lecture',
    'DTSTART;TZID=America/Toronto:20261019T100000',
    'DTEND;TZID=America/Toronto:20261019T110000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:mid',
    'SUMMARY:MAT137 midterm',
    'DTSTART;TZID=America/Toronto:20261105T180000',
    'DTEND;TZID=America/Toronto:20261105T200000',
    'END:VEVENT',
    ...extra,
    'END:VCALENDAR',
  ].join('\r\n');
const feeds: Record<string, string | Error> = {};

beforeAll(async () => {
  pg = await createPgliteDb();
  app = await buildServer({
    db: pg.db,
    verifier: createHsVerifier(TEST_SECRET),
    clock: () => '2026-10-21T12:00:00Z',
    calendar: {
      stateSecret: 'state',
      fetchFeed: async (url) => {
        fetched.push(url);
        const answer = feeds[url];
        if (answer === undefined) throw new FeedError('There’s no calendar at that link any more.');
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  });
  await app.ready();
  token = await signDevToken(TEST_SECRET, USER_A);
  tokenB = await signDevToken(TEST_SECRET, USER_B);
});
afterAll(async () => {
  await app.close();
  await pg.close();
});

const api = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  auth = token,
) =>
  app.inject({
    method,
    url,
    payload: payload as object | undefined,
    headers: { authorization: `Bearer ${auth}`, 'x-timezone': 'America/Toronto' },
  });

const blocksOf = (userId: string) =>
  pg.db.query.plannedBlocks.findMany({
    where: and(eq(plannedBlocks.userId, userId), eq(plannedBlocks.source, 'ics')),
  });

describe('calendars added by link', () => {
  let id = '';

  it('adds a calendar from a webcal link, named after itself, and imports its events', async () => {
    feeds['https://calendar.example.com/secret/basic.ics'] = timetable();
    const res = await api('POST', '/api/calendar/feeds', {
      url: 'webcal://calendar.example.com/secret/basic.ics',
    });
    expect(res.statusCode).toBe(201);
    const { feed, result } = res.json();
    id = feed.id;
    expect(feed).toMatchObject({
      name: 'Fall timetable',
      host: 'calendar.example.com',
      tasks: true,
      events: 7,
      lastError: null,
    });
    expect(feed).not.toHaveProperty('url');
    expect(result).toMatchObject({ status: 'ok', events: 7, courses: 1, tasks: 1 });
    const blocks = await blocksOf(USER_A.id);
    expect(blocks.filter((b) => !b.cancelled)).toHaveLength(7);
    const midterm = await pg.db.query.nodes.findFirst({
      where: and(eq(nodes.userId, USER_A.id), eq(nodes.title, 'MAT137 midterm')),
    });
    expect(midterm?.kind).toBe('assessment');
    // The link opens the whole calendar, so it is never stored as written.
    const row = await pg.db.query.calendarFeeds.findFirst({ where: eq(calendarFeeds.id, id) });
    expect(row?.urlEnc).not.toContain('calendar.example.com');
  });

  it('lists only your own calendars and refuses the same link twice', async () => {
    expect((await api('GET', '/api/calendar/feeds')).json().feeds).toHaveLength(1);
    expect((await api('GET', '/api/calendar/feeds', undefined, tokenB)).json().feeds).toEqual([]);
    const again = await api('POST', '/api/calendar/feeds', {
      url: 'https://calendar.example.com/secret/basic.ics',
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().message ?? again.json().error).toMatch(/Fall timetable/);
    expect(
      (await api('PATCH', `/api/calendar/feeds/${id}`, { name: 'x' }, tokenB)).statusCode,
    ).toBe(404);
  });

  it('says why a link can’t be added', async () => {
    feeds['https://example.com/page'] = '<!doctype html><title>Sign in</title>';
    const page = await api('POST', '/api/calendar/feeds', { url: 'https://example.com/page' });
    expect(page.statusCode).toBe(400);
    expect(JSON.stringify(page.json())).toMatch(/doesn’t lead to a calendar/);
    const local = await api('POST', '/api/calendar/feeds', { url: 'http://127.0.0.1/cal.ics' });
    expect(local.statusCode).toBe(400);
    expect(JSON.stringify(local.json())).toMatch(/private address/);
    const missing = await api('POST', '/api/calendar/feeds', { url: 'https://gone.example/x.ics' });
    expect(JSON.stringify(missing.json())).toMatch(/no calendar at that link/);
    expect((await api('GET', '/api/calendar/feeds')).json().feeds).toHaveLength(1);
  });

  it('refreshes: a dropped event goes, and a failed read keeps the events and says why', async () => {
    feeds['https://calendar.example.com/secret/basic.ics'] = timetable([
      'BEGIN:VEVENT',
      'UID:lec',
      'RECURRENCE-ID;TZID=America/Toronto:20261021T100000',
      'STATUS:CANCELLED',
      'DTSTART;TZID=America/Toronto:20261021T100000',
      'END:VEVENT',
    ]);
    const res = await api('POST', `/api/calendar/feeds/${id}/sync`);
    expect(res.json().feed).toMatchObject({ events: 6, lastError: null });
    expect((await blocksOf(USER_A.id)).filter((b) => !b.cancelled)).toHaveLength(6);

    feeds['https://calendar.example.com/secret/basic.ics'] = new FeedError(
      'That calendar is private. Use its secret or public address instead.',
    );
    const failed = await api('POST', `/api/calendar/feeds/${id}/sync`);
    expect(failed.statusCode).toBe(200);
    expect(failed.json().feed.lastError).toMatch(/private/);
    expect((await blocksOf(USER_A.id)).filter((b) => !b.cancelled)).toHaveLength(6);
  });

  it('can stop making tasks, and renames', async () => {
    feeds['https://calendar.example.com/secret/basic.ics'] = timetable();
    const res = await api('PATCH', `/api/calendar/feeds/${id}`, { tasks: false, name: 'School' });
    expect(res.json().feed).toMatchObject({ name: 'School', tasks: false, lastError: null });
    const midterm = await pg.db.query.nodes.findFirst({
      where: and(eq(nodes.userId, USER_A.id), eq(nodes.title, 'MAT137 midterm')),
    });
    // The untouched task it made is put away; the event itself still shows.
    expect(midterm?.archived).toBe(true);
    expect((await blocksOf(USER_A.id)).filter((b) => !b.cancelled)).toHaveLength(7);
  });

  it('a second calendar refreshes without touching the first', async () => {
    feeds['https://shifts.example.com/me.ics'] = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:shift',
      'SUMMARY:Shift',
      'DTSTART:20261024T140000Z',
      'DTEND:20261024T200000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const res = await api('POST', '/api/calendar/feeds', {
      url: 'https://shifts.example.com/me.ics',
      name: 'Work',
    });
    expect(res.json().feed).toMatchObject({ name: 'Work', host: 'shifts.example.com', events: 1 });
    expect((await blocksOf(USER_A.id)).filter((b) => !b.cancelled)).toHaveLength(8);
    const second = res.json().feed.id;
    await api('POST', `/api/calendar/feeds/${second}/sync`);
    expect((await blocksOf(USER_A.id)).filter((b) => !b.cancelled)).toHaveLength(8);

    expect((await api('DELETE', `/api/calendar/feeds/${second}`)).statusCode).toBe(204);
    expect((await blocksOf(USER_A.id)).filter((b) => !b.cancelled)).toHaveLength(7);
    expect((await api('GET', '/api/calendar/feeds')).json().feeds).toHaveLength(1);
  });

  it('shows the imported events with the other blocks', async () => {
    const res = await api(
      'GET',
      '/api/planned-blocks?from=2026-10-19T00:00:00Z&to=2026-10-26T00:00:00Z',
    );
    expect(res.statusCode).toBe(200);
    const ics = res.json().blocks.filter((b: { source: string }) => b.source === 'ics');
    expect(ics.map((b: { title: string }) => b.title)).toContain('MAT137 lecture');
  });
});

describe('link checks', () => {
  it('turns webcal into https and refuses private or odd addresses', () => {
    expect(normalizeFeedUrl(' webcal://p01.icloud.com/published/2/abc ').toString()).toBe(
      'https://p01.icloud.com/published/2/abc',
    );
    for (const bad of [
      'ftp://example.com/x.ics',
      'http://localhost/x.ics',
      'http://10.0.0.5/x.ics',
      'http://169.254.169.254/latest',
      'http://[::1]/x.ics',
      'https://example.com:8080/x.ics',
      'https://user:pw@example.com/x.ics',
      'not a link',
    ])
      expect(() => normalizeFeedUrl(bad), bad).toThrow(FeedError);
  });

  it('knows which addresses are private', () => {
    expect(isBlockedAddress('192.168.1.10')).toBe(true);
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('fd12::1')).toBe(true);
    expect(isBlockedAddress('142.250.72.14')).toBe(false);
    expect(isBlockedAddress('2607:f8b0:4005:80b::200e')).toBe(false);
  });
});
