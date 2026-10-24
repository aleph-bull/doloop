import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { TimerState } from '@komogon/core';
import { signDevToken } from '../auth/verify';
import { nodes, posts, sessions, universityVerifications, users } from '../db/schema';
import { createLocalMailer } from '../services/mailer';
import { createTestApp, TEST_SECRET, USER_A, USER_B, type TestApp } from './helpers';

let t: TestApp;
const mailer = createLocalMailer();
const ids = [
  USER_A.id,
  USER_B.id,
  ...Array.from(
    { length: 6 },
    (_, i) => `33333333-3333-4333-8333-${String(i + 1).padStart(12, '0')}`,
  ),
];
const tokens: string[] = [];
const now = '2026-10-24T16:00:00.000Z';
const api = (url: string, index = 0) => t.api({ method: 'GET', url, token: tokens[index] });
const settings = (index: number, social: object) =>
  t.api({ method: 'PATCH', url: '/api/me/settings', token: tokens[index], payload: { social } });
beforeAll(async () => {
  t = await createTestApp(now, { mailer });
  for (const [i, id] of ids.entries()) {
    const token = await signDevToken(TEST_SECRET, { id, email: `school-test-${i}@example.test` });
    tokens.push(token);
    await t.api({ method: 'GET', url: '/api/me', token });
    await t.api({ method: 'PATCH', url: '/api/me', token, payload: { onboarded: true } });
  }
  for (const [i, id] of ids.entries()) {
    if (i === 7) continue; // A forged profile field without proof.
    await t.db.insert(universityVerifications).values({
      userId: id,
      universityId: i === 2 ? 'mcmaster' : 'toronto',
      email: `student-${i}@${i === 2 ? 'mcmaster' : 'utoronto'}.ca`,
      codeHash: '',
      verifiedAt: new Date(now),
      expiresAt: new Date(now),
    });
  }
  await settings(3, { leaderboard: 'off' });
  await t.db
    .update(users)
    .set({ devWorld: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
    .where(eq(users.id, ids[4]!));
  await t.db.update(users).set({ isTestAccount: true }).where(eq(users.id, ids[5]!));
  await t.db
    .update(users)
    .set({ bannedAt: new Date(now) })
    .where(eq(users.id, ids[6]!));
  for (const [i, id] of ids.entries()) {
    await t.db.insert(sessions).values({
      userId: id,
      startedAt: new Date('2026-10-24T10:00:00Z'),
      endedAt: new Date('2026-10-24T12:00:00Z'),
      mode: 'unlimited',
      workSeconds: [3600, 1800, 7200][i] ?? 36000,
      timer: {} as TimerState,
    });
  }
});
afterAll(() => t.close());

it('ranks verified schools by completed focus time, preserving privacy and dev-world boundaries', async () => {
  const response = await api('/api/schools/leaderboard');
  expect(response.statusCode, response.body).toBe(200);
  expect(
    response
      .json()
      .entries.map(
        (e: { school: { id: string }; focusMinutes: number; rank: number; members: number }) => [
          e.rank,
          e.school.id,
          e.focusMinutes,
          e.members,
        ],
      ),
  ).toEqual([
    [1, 'mcmaster', 120, 1],
    [2, 'toronto', 90, 2],
  ]);
  expect(response.body).not.toContain('student-');
  expect(response.body).not.toContain('example.test');
  const own = await api('/api/leaderboard?scope=school');
  expect(own.statusCode, own.body).toBe(200);
  expect(own.json().entries.map((e: { userId: string }) => e.userId)).toEqual([ids[0], ids[1]]);
  expect((await api('/api/leaderboard?scope=school', 7)).statusCode).toBe(403);
});

it('switches school rankings between this week and all time and honours opt-outs immediately', async () => {
  await t.db.insert(sessions).values({
    userId: ids[0]!,
    startedAt: new Date('2026-10-01T10:00:00Z'),
    endedAt: new Date('2026-10-01T12:00:00Z'),
    mode: 'unlimited',
    workSeconds: 18000,
    timer: {} as TimerState,
  });
  expect((await api('/api/schools/leaderboard?period=week')).json().entries[0].school.id).toBe(
    'mcmaster',
  );
  expect((await api('/api/schools/leaderboard?period=all')).json().entries[0].school.id).toBe(
    'toronto',
  );
  await settings(1, { leaderboard: 'friends' });
  expect(
    (await api('/api/schools/leaderboard'))
      .json()
      .entries.find((e: { school: { id: string } }) => e.school.id === 'toronto').focusMinutes,
  ).toBe(60);
  expect((await api('/api/leaderboard?scope=school')).json().entries).toHaveLength(1);
  await settings(1, { leaderboard: 'global' });
});

it('shares live sessions and public posts only after a school activity opt-in', async () => {
  const [task] = await t.db
    .insert(nodes)
    .values({ userId: USER_B.id, title: 'Organic chemistry', kind: 'task' })
    .returning();
  const started = await t.api({
    method: 'POST',
    url: '/api/sessions',
    token: tokens[1],
    payload: { nodeId: task!.id, mode: 'unlimited' },
  });
  expect(started.statusCode, started.body).toBe(201);
  const [finished] = await t.db.select().from(sessions).where(eq(sessions.userId, USER_B.id));
  await t.db.insert(posts).values({
    userId: USER_B.id,
    sessionId: finished!.id,
    body: 'Chemistry revision',
    minutes: 30,
    friendsOnly: false,
  });
  expect((await api('/api/schools/community')).json().live).toHaveLength(0);
  expect((await api('/api/schools/community')).json().posts).toHaveLength(0);
  await settings(1, { schoolActivity: true });
  const shared = await api('/api/schools/community');
  expect(shared.json().live).toMatchObject([{ userId: USER_B.id, subject: 'Organic chemistry' }]);
  expect(shared.json().posts).toHaveLength(1);
  expect(shared.body).not.toContain('student-1@');
  await settings(1, { posts: 'friends' });
  expect((await api('/api/schools/community')).json().posts).toHaveLength(0);
  await settings(1, { posts: 'everyone' });
  await t.db.update(posts).set({ friendsOnly: true }).where(eq(posts.userId, USER_B.id));
  expect((await api('/api/schools/community')).json().posts).toHaveLength(0);
  await settings(1, { schoolActivity: false });
  expect((await api('/api/schools/community')).json().live).toHaveLength(0);
});

it('removes school access immediately and does not trust an unverified profile label', async () => {
  expect((await api('/api/schools/community', 7)).json().school).toBeNull();
  await t.api({ method: 'DELETE', url: '/api/me/university', token: tokens[0] });
  expect((await api('/api/schools/community')).json().school).toBeNull();
  expect((await api('/api/leaderboard?scope=school')).statusCode).toBe(403);
  expect((await api('/api/me')).json().user.settings.social.schoolActivity).toBe(false);
});

it('verifies a school outside Ontario through a real code flow, not its email suffix alone', async () => {
  const token = tokens[7];
  const sent = await t.api({
    method: 'POST',
    url: '/api/me/university/send',
    token,
    payload: { email: 'new-student@mit.edu' },
  });
  expect(sent.statusCode, sent.body).toBe(200);
  expect((await api('/api/schools/community', 7)).json().school).toBeNull();
  const code = mailer.messages!.at(-1)!.subject.match(/^\d{6}/)![0];
  const confirmed = await t.api({
    method: 'POST',
    url: '/api/me/university/confirm',
    token,
    payload: { code },
  });
  expect(confirmed.statusCode, confirmed.body).toBe(200);
  expect((await api('/api/me', 7)).json().user.settings.social.schoolActivity).toBe(false);
  expect((await api('/api/schools/community', 7)).json().school.name).toBe(
    'Massachusetts Institute of Technology',
  );
  const profile = await api('/api/profiles/me', 7);
  expect(profile.json().profile.university.name).toBe('Massachusetts Institute of Technology');
  expect(profile.body).not.toContain('new-student@');
  expect(
    (await t.api({ method: 'POST', url: '/api/me/university/confirm', token, payload: { code } }))
      .statusCode,
  ).toBe(400);
});
