import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHsVerifier, signDevToken } from '../auth/verify';
import { createPgliteDb } from '../db/client';
import { buildServer } from '../server';
import { clearTmdbCache, screenFacts, type FetchLike } from '../services/tmdb';
import { createTestApp, TEST_SECRET, USER_A, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp('2026-09-21T14:00:00.000Z'); // Monday 10:00 Toronto
});
afterAll(() => t.close());

async function study(nodeId: string | undefined, minutes: number) {
  const start = await t.api({
    method: 'POST',
    url: '/api/sessions',
    payload: { ...(nodeId ? { nodeId } : {}), mode: 'unlimited' },
  });
  const id = start.json().active.session.id;
  t.clock.now = new Date(Date.parse(t.clock.now) + minutes * 60_000).toISOString();
  await t.api({ method: 'POST', url: `/api/sessions/${id}/end`, payload: {} });
}

describe('recap', () => {
  let course: string;
  let task: string;

  it('welcomes an empty account without errors', async () => {
    const res = await t.api({ method: 'GET', url: '/api/analytics/recap?range=week' });
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.period.minutes).toBe(0);
    expect(r.period.summary).toBe('Your first session puts this week on the board.');
    expect(r.records).toEqual([]);
    expect(r.personality).toBeNull();
    expect(r.subjects).toEqual([]);
  });

  it('draws the week from real sessions, rolled up by course', async () => {
    course = (
      await t.api({
        method: 'POST',
        url: '/api/nodes',
        payload: { title: 'ECO220', kind: 'course' },
      })
    ).json().node.id;
    task = (
      await t.api({
        method: 'POST',
        url: '/api/nodes',
        payload: { title: 'Unit 1', parentId: course },
      })
    ).json().node.id;
    await study(task, 50);
    await study(undefined, 20);

    const r = (await t.api({ method: 'GET', url: '/api/analytics/recap?range=week' })).json();
    expect(r.period.minutes).toBe(70);
    expect(r.period.firstTime).toBe(true);
    expect(r.period.summary).toBe("Your first week is on the board. Here's where you started.");
    expect(r.period.goalMinutes).toBe(300);
    expect(
      r.subjects.map((s: { key: string; colorIndex: number }) => [s.key, s.colorIndex]),
    ).toEqual([
      [course, 0],
      ['free', -1],
    ]);
    expect(r.dailySubjects).toHaveLength(7);
    // Both sessions start in the 10 am hour (10:00 and 10:50).
    expect(r.clock.hours[10]).toBe(70);
    expect(r.cumulative.totalMinutes).toBe(70);
    expect(r.records.map((x: { key: string }) => x.key)).toContain('biggest-day');
    expect(r.level.level).toBeGreaterThanOrEqual(0);
    expect(r.totals.rangeSessions).toBe(2);
    // The hours card is the hero here, so it never comes back as an insight too.
    expect(r.insights.map((i: { key: string }) => i.key)).not.toContain('hours-total');
  });

  it('serves a month and all time', async () => {
    const month = (await t.api({ method: 'GET', url: '/api/analytics/recap?range=month' })).json();
    expect(month.period.from).toBe('2026-09-01');
    expect(month.dailySubjects).toBeNull();
    const all = (await t.api({ method: 'GET', url: '/api/analytics/recap?range=all' })).json();
    expect(all.period).toBeNull();
    expect(all.heatmap.weeks.length).toBe(26);
    expect(all.totals.rangeMinutes).toBe(70);
    const bad = await t.api({ method: 'GET', url: '/api/analytics/recap?range=year' });
    expect(bad.statusCode).toBe(400);
  });

  it('feeds the dashboard strip, against a goal the user can set', async () => {
    let d = (await t.api({ method: 'GET', url: '/api/analytics/dashboard' })).json();
    expect(d.totalMinutes).toBe(70);
    expect(d.weekMinutes).toBe(70);
    expect(d.goalMinutes).toBe(300);
    expect(d.sparkline).toHaveLength(7);
    const set = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { goals: { weeklyMinutes: 140 } },
    });
    expect(set.statusCode).toBe(200);
    d = (await t.api({ method: 'GET', url: '/api/analytics/dashboard' })).json();
    expect(d.goalRatio).toBeCloseTo(0.5);
    const tooSmall = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { goals: { weeklyMinutes: 5 } },
    });
    expect(tooSmall.statusCode).toBe(400);
  });

  it('lists screen facts from the fallback when TMDB is not configured', async () => {
    const r = (await t.api({ method: 'GET', url: '/api/equivalents/screens' })).json();
    expect(r.source).toBe('fallback');
    expect(r.facts.length).toBeGreaterThan(10);
    expect(r.facts.every((f: { posterUrl: string | null }) => f.posterUrl === null)).toBe(true);
  });
});

describe('tmdb', () => {
  beforeEach(() => clearTmdbCache());

  const fake =
    (calls: string[]): FetchLike =>
    async (url) => {
      calls.push(url);
      if (url.includes('/movie/27205'))
        return {
          ok: true,
          json: async () => ({ title: 'Inception', runtime: 148, poster_path: '/i.jpg' }),
        };
      if (url.includes('/tv/1396/season/1'))
        return {
          ok: true,
          json: async () => ({
            poster_path: '/s1.jpg',
            episodes: [{ runtime: 58 }, { runtime: 48 }, {}],
          }),
        };
      if (url.includes('/tv/1396'))
        return { ok: true, json: async () => ({ name: 'Breaking Bad' }) };
      return { ok: false, json: async () => ({}) };
    };

  it('reads runtimes and posters, falls back per title, and caches', async () => {
    const calls: string[] = [];
    const r = await screenFacts({ readToken: 'tok' }, fake(calls));
    expect(r.source).toBe('tmdb');
    const inception = r.facts.find((f) => f.tmdbId === 27205)!;
    expect(inception).toMatchObject({
      minutes: 148,
      approximate: false,
      posterUrl: 'https://image.tmdb.org/t/p/w342/i.jpg',
    });
    // Two episodes known, the third takes their average: 58 + 48 + 53.
    const bb = r.facts.find((f) => f.tmdbId === 1396)!;
    expect(bb).toMatchObject({
      minutes: 159,
      episodes: 3,
      posterUrl: 'https://image.tmdb.org/t/p/w342/s1.jpg',
    });
    // A title TMDB would not answer for keeps its listed runtime and no poster.
    const toy = r.facts.find((f) => f.tmdbId === 862)!;
    expect(toy).toMatchObject({ approximate: true, posterUrl: null });
    expect(calls.every((c) => !c.includes('api_key'))).toBe(true);

    const again: string[] = [];
    await screenFacts({ readToken: 'tok' }, fake(again));
    expect(again.some((c) => c.includes('/movie/27205'))).toBe(false);
  });

  it('sends a v3 key as a query parameter when that is what is set', async () => {
    const calls: string[] = [];
    await screenFacts({ apiKey: 'k3' }, fake(calls));
    expect(calls[0]).toContain('api_key=k3');
  });

  it('never throws when the network does', async () => {
    const boom: FetchLike = async () => {
      throw new Error('offline');
    };
    const r = await screenFacts({ readToken: 'tok' }, boom);
    expect(r.facts.every((f) => f.approximate)).toBe(true);
  });

  it('is reachable through the server with injected credentials', async () => {
    const { db, close } = await createPgliteDb();
    const app = await buildServer({
      db,
      verifier: createHsVerifier(TEST_SECRET),
      tmdb: { readToken: 'tok' },
      tmdbFetch: fake([]),
    });
    await app.ready();
    const token = await signDevToken(TEST_SECRET, USER_A);
    const res = await app.inject({
      method: 'GET',
      url: '/api/equivalents/screens',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json().source).toBe('tmdb');
    await app.close();
    await close();
  });
});
