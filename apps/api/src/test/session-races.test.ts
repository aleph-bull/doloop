import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { advanceClock, createTestApp, type TestApp } from './helpers';

let t: TestApp;
let taskId: string;

beforeAll(async () => {
  t = await createTestApp('2026-09-21T14:00:00.000Z');
  const task = await t.api({
    method: 'POST',
    url: '/api/nodes',
    payload: { title: 'Essay', kind: 'course', estimatedMinutes: 600 },
  });
  taskId = task.json().node.id;
});
afterAll(() => t.close());

const xp = async () => (await t.api({ method: 'GET', url: '/api/me' })).json().user.xp as number;

describe('a session ended from two places at once', () => {
  it('pays an auto-ended session once when two reads finalize it together', async () => {
    const before = await xp();
    const start = await t.api({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        nodeId: taskId,
        mode: 'scheduled',
        plannedEndAt: new Date(Date.parse(t.clock.now) + 30 * 60_000).toISOString(),
      },
    });
    expect(start.statusCode).toBe(201);
    advanceClock(t, 35);
    const reads = await Promise.all(
      [1, 2, 3].map(() => t.api({ method: 'GET', url: '/api/sessions/active' })),
    );
    for (const r of reads) expect(r.json().active).toBeNull();
    const gained = (await xp()) - before;
    expect(gained).toBeGreaterThan(0);
    const history = (
      await t.api({ method: 'GET', url: '/api/sessions/history?limit=1' })
    ).json().sessions;
    expect(history[0].xpAwarded).toBe(gained);
  });

  it('ends once when End is sent twice together', async () => {
    const start = await t.api({
      method: 'POST',
      url: '/api/sessions',
      payload: { nodeId: taskId, mode: 'unlimited' },
    });
    const id = start.json().active.session.id;
    advanceClock(t, 40);
    const before = await xp();
    const ends = await Promise.all(
      [1, 2].map(() =>
        t.api({ method: 'POST', url: `/api/sessions/${id}/end`, payload: { review: null } }),
      ),
    );
    const codes = ends.map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 409]);
    const ok = ends.find((r) => r.statusCode === 200)!;
    expect((await xp()) - before).toBe(ok.json().summary.xp.total);
  });

  it('answers a double-clicked Start with 409, not a server error', async () => {
    const starts = await Promise.all(
      [1, 2].map(() =>
        t.api({ method: 'POST', url: '/api/sessions', payload: { nodeId: taskId, mode: 'unlimited' } }),
      ),
    );
    expect(starts.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  });
});
