import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TimerState } from '@komogon/core';
import { groups, nodes, sessions } from '../db/schema';
import { createTestApp, USER_A, USER_B, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp('2026-09-23T14:00:00.000Z');
  for (const token of [t.tokenA, t.tokenB]) {
    await t.api({ method: 'GET', url: '/api/me', token });
    await t.api({ method: 'PATCH', url: '/api/me', token, payload: { onboarded: true } });
  }
  await t.api({ method: 'PATCH', url: '/api/me/settings', payload: { profile: { name: 'Ada' } } });
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
});
afterAll(() => t.close());

const finished = (userId: string, startedAt: string, workSeconds: number, nodeId?: string) => ({
  userId,
  nodeId: nodeId ?? null,
  startedAt: new Date(startedAt),
  endedAt: new Date(Date.parse(startedAt) + workSeconds * 1000),
  mode: 'unlimited' as const,
  workSeconds,
  timer: {} as TimerState,
});

describe('groups', () => {
  let groupId: string;
  let code: string;

  it('starts a group, shows this week by member with subjects and a running total', async () => {
    const [course] = await t.db
      .insert(nodes)
      .values({ userId: USER_A.id, title: 'IMMUN 201', kind: 'course' })
      .returning();
    await t.db.insert(sessions).values([
      // Monday and Wednesday this week (the week starts 2026-09-21).
      finished(USER_A.id, '2026-09-21T10:00:00Z', 3600, course!.id),
      finished(USER_A.id, '2026-09-23T10:00:00Z', 1800),
      // Last week: not counted.
      finished(USER_A.id, '2026-09-18T10:00:00Z', 7200),
    ]);
    const res = await t.api({
      method: 'POST',
      url: '/api/social/groups',
      payload: { name: 'Study group' },
    });
    expect(res.statusCode).toBe(201);
    const { group } = res.json();
    groupId = group.id;
    code = group.code;
    // A group made today starts today: the earlier sessions sit before its first day.
    expect(group).toMatchObject({
      name: 'Study group',
      you: true,
      days: ['2026-09-23'],
      totalMinutes: 30,
    });
    expect(group.members[0]).toMatchObject({
      userId: USER_A.id,
      minutes: 30,
      byDay: [30],
      subjects: [{ title: 'Free', minutes: 30 }],
      nudgeable: false,
    });
    // Older groups show the last seven days, ending today.
    await t.db.update(groups).set({ createdAt: new Date('2026-09-01T00:00:00Z') });
    const older = (await t.api({ method: 'GET', url: '/api/social/groups' })).json().groups[0];
    expect(older.days).toEqual([
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
    ]);
    expect(older.members[0]).toMatchObject({
      minutes: 210,
      byDay: [0, 120, 120, 120, 180, 180, 210],
      subjects: [
        { title: 'Free', minutes: 150 },
        { title: 'IMMUN 201', minutes: 60 },
      ],
    });
  });

  it("is open to a member's friends, and shows who is live", async () => {
    const seen = (
      await t.api({ method: 'GET', url: '/api/social/groups', token: t.tokenB })
    ).json();
    expect(seen.open.map((g: { id: string }) => g.id)).toEqual([groupId]);
    expect(seen.open[0].code).toBeNull();
    const joined = await t.api({
      method: 'POST',
      url: `/api/social/groups/${groupId}/join`,
      token: t.tokenB,
    });
    expect(joined.statusCode).toBe(200);
    expect(joined.json().group.members).toHaveLength(2);
    // Ben starts a session: Ada sees him live, with what he is on.
    await t.db.insert(sessions).values({
      userId: USER_B.id,
      startedAt: new Date('2026-09-23T13:50:00Z'),
      endedAt: null,
      mode: 'unlimited',
      workSeconds: 500,
      timer: {} as TimerState,
      lastSeenAt: new Date('2026-09-23T13:59:00Z'),
    });
    const mine = (await t.api({ method: 'GET', url: '/api/social/groups' })).json();
    expect(mine.groups[0].live).toEqual([
      { userId: USER_B.id, startedAt: '2026-09-23T13:50:00.000Z', subject: null, state: 'focus' },
    ]);
    expect(mine.live.map((l: { userId: string }) => l.userId)).toEqual([USER_B.id]);
    expect(
      mine.groups[0].members.find((m: { userId: string }) => m.userId === USER_B.id).nudgeable,
    ).toBe(true);
  });

  it('nudges once every two hours, and the nudge waits on the dashboard', async () => {
    const first = await t.api({
      method: 'POST',
      url: '/api/social/nudges',
      payload: { userId: USER_B.id, groupId },
    });
    expect(first.statusCode).toBe(201);
    const again = await t.api({
      method: 'POST',
      url: '/api/social/nudges',
      payload: { userId: USER_B.id },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatch(/Again in 2 h/);
    const theirs = (
      await t.api({ method: 'GET', url: '/api/social/nudges', token: t.tokenB })
    ).json();
    expect(theirs.nudges).toHaveLength(1);
    expect(theirs.nudges[0]).toMatchObject({ fromId: USER_A.id, groupName: 'Study group' });
    expect(theirs.people[USER_A.id].name).toBe('Ada');
    const mine = (await t.api({ method: 'GET', url: '/api/social/groups' })).json();
    expect(
      mine.groups[0].members.find((m: { userId: string }) => m.userId === USER_B.id).nudgeable,
    ).toBe(false);
    await t.api({ method: 'POST', url: '/api/social/nudges/seen', token: t.tokenB });
    const after = (
      await t.api({ method: 'GET', url: '/api/social/nudges', token: t.tokenB })
    ).json();
    expect(after.nudges).toEqual([]);
    t.clock.now = '2026-09-23T16:30:00.000Z';
    const later = await t.api({
      method: 'POST',
      url: '/api/social/nudges',
      payload: { userId: USER_B.id },
    });
    expect(later.statusCode).toBe(201);
  });

  it('joins by code, leaves, and the last one out closes the group', async () => {
    const left = await t.api({
      method: 'POST',
      url: `/api/social/groups/${groupId}/leave`,
      token: t.tokenB,
    });
    expect(left.statusCode).toBe(204);
    const back = await t.api({
      method: 'POST',
      url: '/api/social/groups/join',
      token: t.tokenB,
      payload: { code: code.toLowerCase() },
    });
    expect(back.statusCode).toBe(200);
    await t.api({ method: 'POST', url: `/api/social/groups/${groupId}/leave`, token: t.tokenB });
    await t.api({ method: 'POST', url: `/api/social/groups/${groupId}/leave` });
    const none = (await t.api({ method: 'GET', url: '/api/social/groups' })).json();
    expect(none.groups).toEqual([]);
    const gone = await t.api({ method: 'POST', url: '/api/social/groups/join', payload: { code } });
    expect(gone.statusCode).toBe(404);
  });
});
