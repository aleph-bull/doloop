import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TimerState } from '@komogon/core';
import { sessions } from '../db/schema';
import { newJamCode } from '../routes/jams';
import { createTestApp, USER_A, USER_B, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp('2026-09-23T14:00:00.000Z');
  for (const token of [t.tokenA, t.tokenB]) {
    await t.api({ method: 'GET', url: '/api/me', token });
    await t.api({ method: 'PATCH', url: '/api/me', token, payload: { onboarded: true } });
  }
  await t.api({ method: 'PATCH', url: '/api/me/settings', payload: { profile: { name: 'Ada' } } });
});
afterAll(() => t.close());

const finished = (userId: string, startedAt: string, workSeconds: number) => ({
  userId,
  startedAt: new Date(startedAt),
  endedAt: new Date(Date.parse(startedAt) + workSeconds * 1000),
  mode: 'unlimited' as const,
  workSeconds,
  timer: {} as TimerState,
});

describe('jams', () => {
  let jamId: string;
  let code: string;

  it('makes codes without vowels or confusable letters', () => {
    for (let i = 0; i < 50; i++) expect(newJamCode()).toMatch(/^[BCDFGHJKMNPQRSTVWXYZ2-9]{6}$/);
  });

  it('starts one for three days, with the host in it', async () => {
    // Older focus must not count: only what happens after joining.
    await t.db.insert(sessions).values(finished(USER_A.id, '2026-09-23T10:00:00Z', 3600));
    const res = await t.api({
      method: 'POST',
      url: '/api/social/jams',
      payload: { title: 'Midterm push', days: 3 },
    });
    expect(res.statusCode).toBe(201);
    const { jam } = res.json();
    jamId = jam.id;
    code = jam.code;
    expect(jam).toMatchObject({
      hostId: USER_A.id,
      title: 'Midterm push',
      startsAt: '2026-09-23T14:00:00.000Z',
      endsAt: '2026-09-26T14:00:00.000Z',
      ended: false,
      you: true,
    });
    expect(jam.members).toEqual([
      {
        userId: USER_A.id,
        joinedAt: '2026-09-23T14:00:00.000Z',
        minutes: 0,
        sessions: 0,
        byDay: [0],
        subjects: [],
      },
    ]);
    expect(jam.days).toEqual(['2026-09-23']);
    expect(code).toHaveLength(6);
  });

  it('is open to friends, closed to others without the code', async () => {
    const stranger = await t.api({
      method: 'POST',
      url: `/api/social/jams/${jamId}/join`,
      token: t.tokenB,
    });
    expect(stranger.statusCode).toBe(403);
    const none = (await t.api({ method: 'GET', url: '/api/social/jams', token: t.tokenB })).json();
    expect(none.open).toEqual([]);
    // Ben joins with the code instead, and sees no code of his own until he is in.
    const wrong = await t.api({
      method: 'POST',
      url: '/api/social/jams/join',
      token: t.tokenB,
      payload: { code: 'ZZZZZZ' },
    });
    expect(wrong.statusCode).toBe(404);
    t.clock.now = '2026-09-23T15:00:00.000Z';
    const joined = await t.api({
      method: 'POST',
      url: '/api/social/jams/join',
      token: t.tokenB,
      payload: { code: code.toLowerCase() },
    });
    expect(joined.statusCode).toBe(200);
    expect(
      joined
        .json()
        .jam.members.map((m: { userId: string }) => m.userId)
        .sort(),
    ).toEqual([USER_A.id, USER_B.id].sort());
    expect(joined.json().jam.code).toBe(code);
  });

  it('counts focused minutes from the moment each person joined, and ranks them', async () => {
    await t.db.insert(sessions).values([
      finished(USER_A.id, '2026-09-23T14:30:00Z', 1800),
      // Before Ben joined at 15:00: does not count for him.
      finished(USER_B.id, '2026-09-23T14:30:00Z', 7200),
      finished(USER_B.id, '2026-09-23T16:00:00Z', 2700),
    ]);
    t.clock.now = '2026-09-23T18:00:00.000Z';
    const { active, people } = (await t.api({ method: 'GET', url: '/api/social/jams' })).json();
    expect(active).toHaveLength(1);
    expect(active[0].members).toEqual([
      {
        userId: USER_B.id,
        joinedAt: '2026-09-23T15:00:00.000Z',
        minutes: 45,
        sessions: 1,
        byDay: [45],
        subjects: [{ title: 'Free', minutes: 45 }],
      },
      {
        userId: USER_A.id,
        joinedAt: '2026-09-23T14:00:00.000Z',
        minutes: 30,
        sessions: 1,
        byDay: [30],
        subjects: [{ title: 'Free', minutes: 30 }],
      },
    ]);
    expect(people[USER_A.id].name).toBe('Ada');
  });

  it('lets a member leave, keeps the host, and the host ends it early', async () => {
    const hostLeaves = await t.api({ method: 'POST', url: `/api/social/jams/${jamId}/leave` });
    expect(hostLeaves.statusCode).toBe(400);
    const notHost = await t.api({
      method: 'POST',
      url: `/api/social/jams/${jamId}/end`,
      token: t.tokenB,
    });
    expect(notHost.statusCode).toBe(403);
    t.clock.now = '2026-09-24T09:00:00.000Z';
    const ended = await t.api({ method: 'POST', url: `/api/social/jams/${jamId}/end` });
    expect(ended.json().jam).toMatchObject({ ended: true, endsAt: '2026-09-24T09:00:00.000Z' });
    // Nothing after the end counts, and a late join is refused.
    await t.db.insert(sessions).values(finished(USER_A.id, '2026-09-24T10:00:00Z', 3600));
    const late = await t.api({
      method: 'POST',
      url: '/api/social/jams/join',
      payload: { code },
      token: t.tokenB,
    });
    expect(late.statusCode).toBe(409);
    const list = (await t.api({ method: 'GET', url: '/api/social/jams' })).json();
    expect(list.active).toEqual([]);
    expect(list.ended).toHaveLength(1);
    expect(list.ended[0].members[1]).toMatchObject({ userId: USER_A.id, minutes: 30 });
    const left = await t.api({
      method: 'POST',
      url: `/api/social/jams/${jamId}/leave`,
      token: t.tokenB,
    });
    expect(left.statusCode).toBe(204);
  });

  it("shows a friend's running jam as open, and joining from the list works", async () => {
    const ask = (
      await t.api({
        method: 'POST',
        url: '/api/social/friends/requests',
        payload: { userId: USER_B.id },
      })
    ).json();
    await t.api({
      method: 'POST',
      url: `/api/social/friends/requests/${ask.friendship.requestId}/accept`,
      token: t.tokenB,
    });
    const made = (
      await t.api({ method: 'POST', url: '/api/social/jams', payload: { days: 1 } })
    ).json();
    expect(made.jam.title).toBe('Study jam');
    const seen = (await t.api({ method: 'GET', url: '/api/social/jams', token: t.tokenB })).json();
    expect(seen.open.map((j: { id: string }) => j.id)).toEqual([made.jam.id]);
    expect(seen.open[0].code).toBeNull();
    const joined = await t.api({
      method: 'POST',
      url: `/api/social/jams/${made.jam.id}/join`,
      token: t.tokenB,
    });
    expect(joined.statusCode).toBe(200);
    expect(joined.json().jam.you).toBe(true);
  });
});
