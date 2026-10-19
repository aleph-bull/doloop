import { badgeXp } from '@komogon/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { advanceClock, createTestApp, type TestApp } from './helpers';

/**
 * The alpha journey: what a new tester does in their first sitting, end to end through the
 * real API, as one story. If this passes, the basics a tester will touch first hold together:
 * sign in, onboarding, a course and a task, a session, XP, streak and badges, a reward,
 * grades, settings, and getting their data out and their account deleted.
 *
 * Run before every alpha build (`pnpm alpha:check` runs it with everything else).
 */

let t: TestApp;
const me = async () => (await t.api({ method: 'GET', url: '/api/me' })).json();

beforeAll(async () => {
  // A Monday evening in Toronto.
  t = await createTestApp('2026-09-21T22:00:00.000Z');
});
afterAll(() => t.close());

describe('alpha journey: a new tester’s first sitting', () => {
  let courseId: string;
  let taskId: string;
  let midtermId: string;

  it('signs in fresh and finishes onboarding', async () => {
    const first = await me();
    expect(first.onboarded).toBe(false);
    expect(first.user.xp).toBe(0);
    const res = await t.api({
      method: 'PATCH',
      url: '/api/me',
      payload: { onboarded: true, timezone: 'America/Toronto' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().onboarded).toBe(true);
    const named = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { profile: { name: 'Alpha tester' } },
    });
    expect(named.statusCode).toBe(200);
  });

  it('adds a course, a task and a test', async () => {
    const course = await t.api({
      method: 'POST',
      url: '/api/nodes',
      payload: { title: 'ECO101', kind: 'course' },
    });
    expect(course.statusCode).toBe(201);
    courseId = course.json().node.id;
    const task = await t.api({
      method: 'POST',
      url: '/api/nodes',
      payload: { title: 'Problem set 1', parentId: courseId, estimatedMinutes: 90 },
    });
    taskId = task.json().node.id;
    const midterm = await t.api({
      method: 'POST',
      url: '/api/nodes',
      payload: { title: 'Midterm', parentId: courseId, kind: 'assessment' },
    });
    midtermId = midterm.json().node.id;
    const tree = (await t.api({ method: 'GET', url: '/api/nodes' })).json().nodes;
    expect(tree.map((n: { title: string }) => n.title)).toEqual(
      expect.arrayContaining(['ECO101', 'Problem set 1', 'Midterm']),
    );
  });

  it('sets a reward that the midterm unlocks', async () => {
    const res = await t.api({
      method: 'POST',
      url: '/api/rewards',
      payload: { name: 'New pants', costXp: 0, unlock: 'task', unlockNodeId: midtermId },
    });
    expect(res.statusCode).toBe(201);
    const shelf = (await t.api({ method: 'GET', url: '/api/rewards' })).json().rewards;
    expect(shelf[0]).toMatchObject({ name: 'New pants', redeemable: false });
  });

  it('studies for 50 minutes and is paid for it, badges included', async () => {
    const start = await t.api({
      method: 'POST',
      url: '/api/sessions',
      payload: { nodeId: taskId, mode: 'unlimited' },
    });
    expect(start.statusCode).toBe(201);
    const id = start.json().active.session.id;
    advanceClock(t, 50);
    const end = await t.api({
      method: 'POST',
      url: `/api/sessions/${id}/end`,
      payload: { review: { distracted: 'no', mood: 4 } },
    });
    expect(end.statusCode).toBe(200);
    const { summary } = end.json();
    expect(summary.session.workSeconds).toBe(50 * 60);
    expect(summary.xp.total).toBeGreaterThan(0);
    expect(summary.streak.current).toBe(1);
    expect(summary.badges).toContain('first-session');
    const badgeTotal = summary.badges.reduce((s: number, k: string) => s + badgeXp(k), 0);
    expect(summary.xpTotal).toBe(summary.xp.total + badgeTotal);
    expect((await me()).user.xp).toBe(summary.xpTotal);
  });

  it('finishes the midterm and redeems the reward', async () => {
    const done = await t.api({
      method: 'PATCH',
      url: `/api/nodes/${midtermId}`,
      payload: { completedAt: t.clock.now },
    });
    expect(done.statusCode).toBe(200);
    const shelf = (await t.api({ method: 'GET', url: '/api/rewards' })).json().rewards;
    expect(shelf[0].redeemable).toBe(true);
    const redeem = await t.api({ method: 'POST', url: `/api/rewards/${shelf[0].id}/redeem` });
    expect(redeem.statusCode).toBe(200);
    expect(redeem.json().spent).toBe(0);
  });

  it('enters a grade and sees it in Grades', async () => {
    const res = await t.api({
      method: 'PATCH',
      url: `/api/nodes/${courseId}`,
      payload: { gradeMode: 'overall', gradeOverall: 84 },
    });
    expect(res.statusCode).toBe(200);
    const grades = (await t.api({ method: 'GET', url: '/api/grades' })).json();
    expect(grades.gpa.courseCount).toBe(1);
    expect(grades.gpa.points).not.toBeNull();
  });

  it('makes it theirs in Settings, within the limits', async () => {
    const ok = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: {
        theme: { accent: 'custom:20,80,55', backgroundId: 'solid:#1f2433' },
        streak: { dayStartHour: 5 },
        timelapse: { recordBreaks: true },
      },
    });
    expect(ok.statusCode).toBe(200);
    // The day start is held for a day once changed.
    const again = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { streak: { dayStartHour: 3 } },
    });
    expect(again.statusCode).toBe(400);
  });

  it('sees their week in Analytics', async () => {
    const recap = await t.api({ method: 'GET', url: '/api/analytics/recap?range=week' });
    expect(recap.statusCode).toBe(200);
    expect(recap.json().period.minutes).toBe(50);
  });

  it('can take their data out, then delete their account', async () => {
    const exp = await t.api({ method: 'GET', url: '/api/me/export' });
    expect(exp.statusCode).toBe(200);
    expect(exp.json().nodes.length).toBe(3);
    const del = await t.api({ method: 'DELETE', url: '/api/me' });
    expect(del.statusCode).toBe(204);
    // Signing in again starts from nothing.
    const fresh = await me();
    expect(fresh.user.xp).toBe(0);
    expect((await t.api({ method: 'GET', url: '/api/nodes' })).json().nodes).toEqual([]);
  });
});
