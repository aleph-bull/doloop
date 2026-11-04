import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHsVerifier, signDevToken } from '../auth/verify';
import { createPgliteDb } from '../db/client';
import { buildServer } from '../server';
import {
  GoogleRevokedError,
  GoogleSyncTokenExpiredError,
  type EventInput,
  type GoogleCalendarClient,
  type GoogleEvent,
} from '../services/google';
import { TEST_SECRET, USER_A } from './helpers';

/** In-memory Google Calendar: one Study calendar, events keyed by id, sync tokens as counters. */
class FakeGoogle implements GoogleCalendarClient {
  events = new Map<string, GoogleEvent & { calendarId: string }>();
  calendars: Array<{ id: string; summary: string }> = [];
  revoked = false;
  expireSyncTokenOnce = false;
  busy: Array<{ start: string; end: string }> = [];
  version = 0;
  seq = 0;
  calls: string[] = [];

  authUrl(state: string) {
    return `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`;
  }
  async exchangeCode(code: string) {
    this.calls.push(`exchange:${code}`);
    return { accessToken: 'at', refreshToken: `rt-${code}`, expiresAt: Date.now() + 3600_000 };
  }
  async refreshAccessToken() {
    if (this.revoked) throw new GoogleRevokedError();
    return { accessToken: 'at2', refreshToken: null, expiresAt: Date.now() + 3600_000 };
  }
  async listCalendars() {
    return this.calendars;
  }
  async createCalendar(_at: string, summary: string) {
    const id = `cal-${++this.seq}`;
    this.calendars.push({ id, summary });
    return { id };
  }
  async insertEvent(_at: string, calendarId: string, e: EventInput) {
    const id = `ev-${++this.seq}`;
    this.events.set(id, {
      id,
      calendarId,
      status: 'confirmed',
      summary: e.summary,
      start: { dateTime: e.start },
      end: { dateTime: e.end },
      updated: String(++this.version),
    });
    this.calls.push(`insert:${e.summary}`);
    return { id };
  }
  async updateEvent(_at: string, _cal: string, id: string, e: EventInput) {
    const ev = this.events.get(id);
    if (ev)
      Object.assign(ev, {
        summary: e.summary,
        start: { dateTime: e.start },
        end: { dateTime: e.end },
        updated: String(++this.version),
      });
    this.calls.push(`update:${id}`);
  }
  async deleteEvent(_at: string, _cal: string, id: string) {
    const ev = this.events.get(id);
    if (ev) Object.assign(ev, { status: 'cancelled', updated: String(++this.version) });
    this.calls.push(`delete:${id}`);
  }
  async listEvents(_at: string, calendarId: string, opts: { syncToken?: string | null }) {
    if (this.expireSyncTokenOnce && opts.syncToken) {
      this.expireSyncTokenOnce = false;
      throw new GoogleSyncTokenExpiredError();
    }
    const since = opts.syncToken ? Number(opts.syncToken) : 0;
    const items = [...this.events.values()].filter(
      (e) => e.calendarId === calendarId && Number(e.updated) > since,
    );
    return { items, nextSyncToken: String(this.version) };
  }
  async freeBusy() {
    return this.busy;
  }
  /** Simulate the user editing directly in Google. */
  externalCreate(calendarId: string, start: string, end: string) {
    const id = `ext-${++this.seq}`;
    this.events.set(id, {
      id,
      calendarId,
      status: 'confirmed',
      summary: 'Library',
      start: { dateTime: start },
      end: { dateTime: end },
      updated: String(++this.version),
    });
    return id;
  }
  externalMove(id: string, start: string, end: string) {
    Object.assign(this.events.get(id)!, {
      start: { dateTime: start },
      end: { dateTime: end },
      updated: String(++this.version),
    });
  }
  externalDelete(id: string) {
    Object.assign(this.events.get(id)!, { status: 'cancelled', updated: String(++this.version) });
  }
}

const KEY = 'a'.repeat(64);
let app: Awaited<ReturnType<typeof buildServer>>;
let close: () => Promise<void>;
let token: string;
let google: FakeGoogle;
const clock = { now: '2026-09-21T14:00:00.000Z' };
const api = ({ auth, ...opts }: InjectOptions & { auth?: boolean }) =>
  app.inject({
    ...opts,
    headers: {
      ...(auth === false ? {} : { authorization: `Bearer ${token}` }),
      'x-timezone': 'America/Toronto',
    },
  });

beforeAll(async () => {
  const pg = await createPgliteDb();
  close = pg.close;
  google = new FakeGoogle();
  app = await buildServer({
    db: pg.db,
    verifier: createHsVerifier(TEST_SECRET),
    clock: () => clock.now,
    calendar: {
      deps: { google, encryptionKey: KEY },
      stateSecret: 'state',
      portalUrl: 'http://portal.test',
    },
  });
  await app.ready();
  token = await signDevToken(TEST_SECRET, USER_A);
});
afterAll(async () => {
  await app.close();
  await close();
});

describe('Google Calendar sync', () => {
  let nodeId: string;
  let blockId: string;

  it('starts disconnected and produces a consent URL', async () => {
    const status = await api({ method: 'GET', url: '/api/calendar/google/status' });
    expect(status.json()).toMatchObject({ available: true, connected: false });
    const res = await api({ method: 'POST', url: '/api/calendar/google/connect' });
    expect(res.json().url).toMatch(/accounts\.google\.com/);
  });

  it('completes the callback, creates the Study calendar, and redirects to settings', async () => {
    const url = (await api({ method: 'POST', url: '/api/calendar/google/connect' })).json()
      .url as string;
    const state = new URL(url).searchParams.get('state')!;
    const res = await api({
      method: 'GET',
      url: `/api/calendar/google/callback?code=abc&state=${encodeURIComponent(state)}`,
      auth: false,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://portal.test/settings?google=connected#calendar');
    expect(google.calendars.map((c) => c.summary)).toEqual(['Study']);
    const status = await api({ method: 'GET', url: '/api/calendar/google/status' });
    expect(status.json()).toMatchObject({
      connected: true,
      revoked: false,
      studyCalendarId: google.calendars[0]!.id,
    });
  });

  it('rejects a bad state', async () => {
    const res = await api({
      method: 'GET',
      url: '/api/calendar/google/callback?code=abc&state=nope.x.y',
      auth: false,
    });
    expect(res.headers.location).toBe('http://portal.test/settings?google=invalid#calendar');
  });

  it('pushes app-created blocks as events immediately and on sync', async () => {
    nodeId = (
      await api({
        method: 'POST',
        url: '/api/nodes',
        payload: { title: 'HW1', estimatedMinutes: 120 },
      })
    ).json().node.id;
    const res = await api({
      method: 'POST',
      url: '/api/planned-blocks',
      payload: { nodeId, startAt: '2026-09-22T14:00:00.000Z', endAt: '2026-09-22T16:00:00.000Z' },
    });
    blockId = res.json().block.id;
    expect(res.json().block.googleEventId).toMatch(/^ev-/);
    expect(google.calls).toContain('insert:Study: HW1');
    const sync = await api({ method: 'POST', url: '/api/calendar/google/sync' });
    expect(sync.json()).toMatchObject({ status: 'ok', pushed: 0 });
  });

  it('propagates app edits and deletes to Google', async () => {
    await api({
      method: 'PATCH',
      url: `/api/planned-blocks/${blockId}`,
      payload: { endAt: '2026-09-22T17:00:00.000Z' },
    });
    const ev = [...google.events.values()][0]!;
    expect(ev.end?.dateTime).toBe('2026-09-22T17:00:00.000Z');
    await api({ method: 'DELETE', url: `/api/planned-blocks/${blockId}` });
    expect(google.events.get(ev.id)!.status).toBe('cancelled');
  });

  it('pulls Google changes: moved events update blocks, deleted events cancel them, new events import unlinked', async () => {
    const created = await api({
      method: 'POST',
      url: '/api/planned-blocks',
      payload: { nodeId, startAt: '2026-09-23T14:00:00.000Z', endAt: '2026-09-23T15:00:00.000Z' },
    });
    const id = created.json().block.id as string;
    const evId = created.json().block.googleEventId as string;
    await api({ method: 'POST', url: '/api/calendar/google/sync' }); // establishes sync token
    google.externalMove(evId, '2026-09-23T16:00:00.000Z', '2026-09-23T17:30:00.000Z');
    const calId = google.calendars[0]!.id;
    const extId = google.externalCreate(
      calId,
      '2026-09-24T14:00:00.000Z',
      '2026-09-24T15:00:00.000Z',
    );
    let sync = await api({ method: 'POST', url: '/api/calendar/google/sync' });
    expect(sync.json()).toMatchObject({ status: 'ok', pulled: 1, imported: 1 });
    const blocks = (await api({ method: 'GET', url: '/api/planned-blocks' })).json()
      .blocks as Array<{
      id: string;
      startAt: string;
      endAt: string;
      nodeId: string | null;
      source: string;
      googleEventId: string | null;
      cancelled: boolean;
    }>;
    const moved = blocks.find((b) => b.id === id)!;
    expect(moved.startAt).toBe('2026-09-23T16:00:00.000Z');
    expect(moved.endAt).toBe('2026-09-23T17:30:00.000Z');
    const imported = blocks.find((b) => b.googleEventId === extId)!;
    expect(imported.source).toBe('google');
    expect(imported.nodeId).toBeNull();
    // The import is a commitment: listed so the week can be planned around it, never
    // offered up as study time.
    const commitments = await api({ method: 'GET', url: '/api/calendar/commitments' });
    expect(commitments.json().blocks.map((b: { id: string }) => b.id)).toEqual([imported.id]);
    const link = await api({
      method: 'PATCH',
      url: `/api/planned-blocks/${imported.id}`,
      payload: { nodeId },
    });
    expect(link.statusCode).toBe(400);
    // ...and it is not counted as time set aside to study.
    const pace = await api({ method: 'GET', url: '/api/pace' });
    expect(pace.json().plannedMinutes[nodeId]).toBe(90); // only the app block, 16:00-17:30
    // Delete in Google -> cancelled here.
    google.externalDelete(evId);
    sync = await api({ method: 'POST', url: '/api/calendar/google/sync' });
    expect(sync.json().pulled).toBe(1);
    const after = (await api({ method: 'GET', url: '/api/planned-blocks' }))
      .json()
      .blocks.find((b: { id: string }) => b.id === id);
    expect(after.cancelled).toBe(true);
  });

  it('recovers from an expired sync token with a full resync', async () => {
    google.expireSyncTokenOnce = true;
    const sync = await api({ method: 'POST', url: '/api/calendar/google/sync' });
    expect(sync.json().status).toBe('ok');
  });

  it('suggests free slots around busy times and blocks', async () => {
    google.busy = [{ start: '2026-09-22T13:00:00.000Z', end: '2026-09-22T18:00:00.000Z' }];
    const res = await api({
      method: 'GET',
      url: '/api/calendar/suggest?minutes=60&from=2026-09-22T12:00:00.000Z&days=1',
    });
    expect(res.json().slots[0]).toEqual({
      start: '2026-09-22T12:00:00.000Z',
      end: '2026-09-22T13:00:00.000Z',
    });
    expect(res.json().slots[1]).toEqual({
      start: '2026-09-22T18:00:00.000Z',
      end: '2026-09-22T19:00:00.000Z',
    });
    const busy = await api({
      method: 'GET',
      url: '/api/calendar/busy?from=2026-09-22T00:00:00.000Z&to=2026-09-23T00:00:00.000Z',
    });
    expect(busy.json().busy).toHaveLength(1);
  });

  it('handles revocation gracefully and can disconnect', async () => {
    google.revoked = true;
    const sync = await api({ method: 'POST', url: '/api/calendar/google/sync' });
    expect(sync.json().status).toBe('revoked');
    const status = await api({ method: 'GET', url: '/api/calendar/google/status' });
    expect(status.json().revoked).toBe(true);
    const del = await api({ method: 'DELETE', url: '/api/calendar/google' });
    expect(del.statusCode).toBe(204);
    expect(
      (await api({ method: 'GET', url: '/api/calendar/google/status' })).json().connected,
    ).toBe(false);
    google.revoked = false;
  });
});

describe('.ics', () => {
  it('serves the secret feed publicly and the export with auth', async () => {
    // A block of its own: earlier tests leave HW1's blocks cancelled or imported.
    const hw1 = (await api({ method: 'GET', url: '/api/nodes' }))
      .json()
      .nodes.find((n: { title: string }) => n.title === 'HW1');
    await api({
      method: 'POST',
      url: '/api/planned-blocks',
      payload: {
        nodeId: hw1.id,
        startAt: '2026-09-30T14:00:00.000Z',
        endAt: '2026-09-30T15:00:00.000Z',
      },
    });
    const me = await api({ method: 'GET', url: '/api/me' });
    const feedToken = me.json().icsToken as string;
    const feed = await api({ method: 'GET', url: `/calendar.ics?token=${feedToken}`, auth: false });
    expect(feed.statusCode).toBe(200);
    expect(feed.headers['content-type']).toMatch(/text\/calendar/);
    expect(feed.body).toContain('BEGIN:VCALENDAR');
    expect(feed.body).toContain('SUMMARY:Study: HW1');
    expect(feed.body).not.toContain('Studied:');
    const bad = await api({
      method: 'GET',
      url: '/calendar.ics?token=nope-nope-nope',
      auth: false,
    });
    expect(bad.statusCode).toBe(404);
    const exp = await api({ method: 'GET', url: '/api/calendar/export.ics?sessions=true' });
    expect(exp.headers['content-disposition']).toMatch(/komogon\.ics/);
    // Rotating the token invalidates the old feed URL.
    const rotated = await api({ method: 'POST', url: '/api/me/ics-token' });
    expect(
      (await api({ method: 'GET', url: `/calendar.ics?token=${feedToken}`, auth: false }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await api({
          method: 'GET',
          url: `/calendar.ics?token=${rotated.json().icsToken}`,
          auth: false,
        })
      ).statusCode,
    ).toBe(200);
  });
});
