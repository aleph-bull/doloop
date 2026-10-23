import { badgeXp } from '@komogon/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessions } from '../db/schema';
import { advanceClock, createTestApp, type TestApp } from './helpers';

let t: TestApp;
let courseId: string;
let hwId: string;

beforeAll(async () => {
  // Monday 2026-09-21 10:00 Toronto
  t = await createTestApp('2026-09-21T14:00:00.000Z');
  const course = await t.api({
    method: 'POST',
    url: '/api/nodes',
    payload: { title: 'EAS101', kind: 'course' },
  });
  courseId = course.json().node.id;
  const hw = await t.api({
    method: 'POST',
    url: '/api/nodes',
    payload: {
      title: 'Homework 1',
      parentId: courseId,
      estimatedMinutes: 120,
      dueAt: '2026-09-26T04:00:00.000Z', // Sat local midnight -> due Fri 25 local? No: 04:00Z Sat = Sat 00:00 EDT
    },
  });
  hwId = hw.json().node.id;
});
afterAll(() => t.close());

describe('session lifecycle', () => {
  let sessionId: string;

  it('starts a pomodoro session and refuses a second one', async () => {
    const res = await t.api({
      method: 'POST',
      url: '/api/sessions',
      payload: { nodeId: hwId, mode: 'pomodoro' },
    });
    expect(res.statusCode).toBe(201);
    const { active } = res.json();
    sessionId = active.session.id;
    expect(active.timer.phase).toBe('work');
    expect(active.view.phaseRemainingSeconds).toBe(1500);
    expect(active.nodeTitle).toBe('Homework 1');
    const again = await t.api({
      method: 'POST',
      url: '/api/sessions',
      payload: { nodeId: hwId, mode: 'unlimited' },
    });
    expect(again.statusCode).toBe(409);
  });

  it('materializes pomodoro transitions on read', async () => {
    advanceClock(t, 27);
    const res = await t.api({ method: 'GET', url: '/api/sessions/active' });
    const { active } = res.json();
    expect(active.timer.phase).toBe('short-break');
    expect(active.view.workSeconds).toBe(1500);
    expect(active.view.breakSeconds).toBe(120);
  });

  it('applies events: skip break, pause, resume', async () => {
    let res = await t.api({
      method: 'POST',
      url: `/api/sessions/${sessionId}/events`,
      payload: { type: 'skip-break' },
    });
    expect(res.json().active.timer.phase).toBe('work');
    advanceClock(t, 10);
    // The idle events of older builds are gone from the API, not just from the app.
    const gone = await t.api({
      method: 'POST',
      url: `/api/sessions/${sessionId}/events`,
      payload: { type: 'idle-start', idleSince: t.clock.now },
    });
    expect(gone.statusCode).toBe(400);
    res = await t.api({
      method: 'POST',
      url: `/api/sessions/${sessionId}/events`,
      payload: { type: 'pause' },
    });
    expect(res.json().active.timer.phase).toBe('paused');
    advanceClock(t, 3);
    res = await t.api({
      method: 'POST',
      url: `/api/sessions/${sessionId}/events`,
      payload: { type: 'resume' },
    });
    expect(res.json().active.timer.phase).toBe('work');
    advanceClock(t, 5);
  });

  it('ends with a full review and awards XP, streak, phrase, estimate change', async () => {
    const res = await t.api({
      method: 'POST',
      url: `/api/sessions/${sessionId}/end`,
      payload: {
        review: {
          distracted: 'no',
          mood: 4,
          completedCount: 12,
          correctCount: 10,
          extraMinutesAdded: 60,
          note: ' good ',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const { summary } = res.json();
    // work: 25 (first interval) + 10 (before the pause) + 5 (after resume) = 40 min
    expect(summary.session.workSeconds).toBe(2400);
    expect(summary.session.breakSeconds).toBe(120);
    expect(summary.session.idleSeconds).toBe(0);
    expect(summary.session.review).toMatchObject({
      skipped: false,
      distracted: 'no',
      mood: 4,
      note: 'good',
    });
    // 40 focused minutes -> 80 base; review 10%, focus 20%, streak day 1
    expect(summary.xp.base).toBe(80);
    expect(summary.xp.reviewSubmitted).toBe(8);
    expect(summary.xp.focus).toBe(16);
    expect(summary.streak.current).toBe(1);
    expect(summary.xp.streakBonus).toBe(1);
    expect(summary.endedEarly).toBe(false);
    expect(summary.phrase).not.toBeNull();
    expect(summary.isFirstSessionOnNode).toBe(true);
    expect(summary.confetti).toBe(true);
    // The total also holds what the badges this session unlocked paid.
    const badgeTotal = summary.badges.reduce((s: number, k: string) => s + badgeXp(k), 0);
    expect(badgeTotal).toBeGreaterThan(0);
    expect(summary.xpTotal).toBe(summary.xp.total + badgeTotal);

    const nodesRes = await t.api({ method: 'GET', url: '/api/nodes' });
    const hw = nodesRes.json().nodes.find((n: { id: string }) => n.id === hwId);
    expect(hw.estimatedMinutes).toBe(180);

    const me = await t.api({ method: 'GET', url: '/api/me' });
    expect(me.json().user.xp).toBe(summary.xpTotal);
    expect(me.json().user.streak.current).toBe(1);
    // Kept on the session for its post.
    const row = await t.db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
    expect(row!.streak).toBe(1);

    const again = await t.api({
      method: 'POST',
      url: `/api/sessions/${sessionId}/end`,
      payload: {},
    });
    expect(again.statusCode).toBe(409);
  });

  it('exposes pace with logged work and the daily plan', async () => {
    const res = await t.api({ method: 'GET', url: '/api/pace' });
    const { pace, plan } = res.json();
    expect(pace[hwId].loggedWorkMinutes).toBe(40);
    expect(pace[hwId].remainingMinutes).toBe(140);
    expect(pace[courseId].aggregated).toBe(true);
    expect(pace[courseId].loggedWorkMinutes).toBe(40);
    expect(plan[0].nodeId).toBe(hwId);
    expect(plan[0].suggestedMinutes).toBeGreaterThan(0);
  });

  it('skipped review still saves the session with effort XP', async () => {
    advanceClock(t, 60);
    const start = await t.api({
      method: 'POST',
      url: '/api/sessions',
      payload: { nodeId: hwId, mode: 'unlimited' },
    });
    const id = start.json().active.session.id;
    advanceClock(t, 20);
    const res = await t.api({
      method: 'POST',
      url: `/api/sessions/${id}/end`,
      payload: { review: { skipped: true } },
    });
    const { summary } = res.json();
    expect(summary.session.review.skipped).toBe(true);
    expect(summary.xp.base).toBe(40);
    expect(summary.xp.reviewSubmitted).toBe(0);
    expect(summary.xp.focus).toBe(0);
    expect(summary.isFirstSessionOnNode).toBe(false);
  });

  it('a free session has no task and no routine, and still counts', async () => {
    advanceClock(t, 60);
    const start = await t.api({
      method: 'POST',
      url: '/api/sessions',
      payload: { mode: 'unlimited' },
    });
    expect(start.statusCode).toBe(201);
    const { active } = start.json();
    expect(active.session.nodeId).toBeNull();
    expect(active.session.routineId).toBeNull();
    expect(active.nodeTitle).toBe('Free session');
    const seen = await t.api({ method: 'GET', url: '/api/sessions/active' });
    expect(seen.json().active.nodeTitle).toBe('Free session');
    advanceClock(t, 30);
    const res = await t.api({
      method: 'POST',
      url: `/api/sessions/${active.session.id}/end`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const { summary } = res.json();
    expect(summary.xp.base).toBe(60);
    expect(summary.nodeCompleted).toBe(false);
    expect(summary.routineTicked).toBe(false);
    expect(summary.statusAfter).toBe('no-estimate');
    // It sits on the calendar under its own name, since there is no task to name it after.
    const blocks = (await t.api({ method: 'GET', url: '/api/planned-blocks' })).json().blocks;
    const logged = blocks.find((b: { sessionId: string }) => b.sessionId === active.session.id);
    expect(logged).toMatchObject({ nodeId: null, title: 'Free session', source: 'session' });
    const s = await t.api({ method: 'GET', url: `/api/sessions/${active.session.id}` });
    expect(s.json().session.endedAt).not.toBeNull();
    expect(s.json().session.xpAwarded).toBeGreaterThan(0);
  });

  it('scheduled sessions auto-end after the grace period and are finalized on read', async () => {
    advanceClock(t, 60);
    const plannedEndAt = new Date(Date.parse(t.clock.now) + 30 * 60_000).toISOString();
    const start = await t.api({
      method: 'POST',
      url: '/api/sessions',
      payload: { nodeId: hwId, mode: 'scheduled', plannedEndAt },
    });
    expect(start.statusCode).toBe(201);
    const id = start.json().active.session.id;
    advanceClock(t, 30, 30);
    let active = await t.api({ method: 'GET', url: '/api/sessions/active' });
    expect(active.json().active.view.graceRemainingSeconds).toBe(30);
    advanceClock(t, 1);
    active = await t.api({ method: 'GET', url: '/api/sessions/active' });
    expect(active.json().active).toBeNull();
    const s = await t.api({ method: 'GET', url: `/api/sessions/${id}` });
    expect(s.json().session.workSeconds).toBe(1800);
    expect(s.json().session.endedAt).toBe(plannedEndAt);
    // A new session can start now.
    const next = await t.api({
      method: 'POST',
      url: '/api/sessions',
      payload: { nodeId: hwId, mode: 'unlimited' },
    });
    expect(next.statusCode).toBe(201);
    await t.api({
      method: 'POST',
      url: `/api/sessions/${next.json().active.session.id}/end`,
      payload: {},
    });
  });

  it('rejects scheduled sessions without a future plannedEndAt', async () => {
    const res = await t.api({
      method: 'POST',
      url: '/api/sessions',
      payload: { nodeId: hwId, mode: 'scheduled' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('marks a node complete at end and awards the estimate-beat bonus', async () => {
    const node = await t.api({
      method: 'POST',
      url: '/api/nodes',
      payload: { title: 'Quick', estimatedMinutes: 10 },
    });
    const id = node.json().node.id;
    const start = await t.api({
      method: 'POST',
      url: '/api/sessions',
      payload: { nodeId: id, mode: 'unlimited' },
    });
    advanceClock(t, 8);
    const res = await t.api({
      method: 'POST',
      url: `/api/sessions/${start.json().active.session.id}/end`,
      payload: { markComplete: true },
    });
    const { summary } = res.json();
    expect(summary.nodeCompleted).toBe(true);
    expect(summary.statusAfter).toBe('done');
    // 8 focused minutes -> 16 base; estimate beat 20% = 3, on pace 10% = 1
    expect(summary.xp.estimateBeat).toBe(3);
    expect(summary.xp.onPace).toBe(1);
    expect(summary.phrase.bucket).toBe('node-completed');
  });

  it('lists sessions newest first and filters by node', async () => {
    const res = await t.api({ method: 'GET', url: `/api/sessions?nodeId=${hwId}` });
    const list = res.json().sessions;
    expect(list.length).toBe(4);
    // The free session is listed too, just not under any task.
    const all = (await t.api({ method: 'GET', url: '/api/sessions' })).json().sessions;
    expect(all.length).toBeGreaterThan(list.length);
    expect(all.filter((s: { nodeId: string | null }) => s.nodeId === null).length).toBe(1);
    for (let i = 1; i < list.length; i++)
      expect(list[i - 1].startedAt >= list[i].startedAt).toBe(true);
  });
});

describe('early cancellation', () => {
  it('a pomodoro ended before its first work interval earns no XP while under ten minutes', async () => {
    const node = (
      await t.api({ method: 'POST', url: '/api/nodes', payload: { title: 'Early' } })
    ).json().node;
    const start = await t.api({
      method: 'POST',
      url: '/api/sessions',
      payload: { nodeId: node.id, mode: 'pomodoro' },
    });
    advanceClock(t, 8);
    const res = await t.api({
      method: 'POST',
      url: `/api/sessions/${start.json().active.session.id}/end`,
      payload: { review: { distracted: 'no' } },
    });
    const { summary } = res.json();
    expect(summary.endedEarly).toBe(true);
    expect(summary.xp.total).toBe(0);
    expect(summary.xp.withheld).toBe(true);
    expect(summary.confetti).toBe(false);
    expect(summary.session.workSeconds).toBe(480);
  });

  it('a pomodoro ended early with ten focused minutes in is paid for them', async () => {
    const node = (
      await t.api({ method: 'POST', url: '/api/nodes', payload: { title: 'Ten' } })
    ).json().node;
    const start = await t.api({
      method: 'POST',
      url: '/api/sessions',
      payload: { nodeId: node.id, mode: 'pomodoro' },
    });
    advanceClock(t, 10);
    const res = await t.api({
      method: 'POST',
      url: `/api/sessions/${start.json().active.session.id}/end`,
      payload: { review: { distracted: 'no' } },
    });
    const { summary } = res.json();
    expect(summary.endedEarly).toBe(true);
    expect(summary.xp.withheld).toBe(false);
    expect(summary.xp.base).toBe(20);
    expect(summary.confetti).toBe(true);
  });

  it('finishing the task pays however short the session was', async () => {
    const node = (
      await t.api({
        method: 'POST',
        url: '/api/nodes',
        payload: { title: 'Quick win', estimatedMinutes: 30 },
      })
    ).json().node;
    const start = await t.api({
      method: 'POST',
      url: '/api/sessions',
      payload: { nodeId: node.id, mode: 'pomodoro' },
    });
    advanceClock(t, 4);
    const res = await t.api({
      method: 'POST',
      url: `/api/sessions/${start.json().active.session.id}/end`,
      payload: { review: { skipped: true }, markComplete: true },
    });
    const { summary } = res.json();
    expect(summary.endedEarly).toBe(true);
    expect(summary.nodeCompleted).toBe(true);
    expect(summary.xp.withheld).toBe(false);
    expect(summary.xp.base).toBe(8);
    expect(summary.xp.estimateBeat).toBe(1);
    expect(summary.confetti).toBe(true);
  });

  it('a scheduled session stopped before its planned end earns no XP, but full XP when it runs to the end', async () => {
    const node = (
      await t.api({ method: 'POST', url: '/api/nodes', payload: { title: 'Sched' } })
    ).json().node;
    let plannedEndAt = new Date(Date.parse(t.clock.now) + 30 * 60_000).toISOString();
    let start = await t.api({
      method: 'POST',
      url: '/api/sessions',
      payload: { nodeId: node.id, mode: 'scheduled', plannedEndAt },
    });
    advanceClock(t, 7);
    let res = await t.api({
      method: 'POST',
      url: `/api/sessions/${start.json().active.session.id}/end`,
      payload: {},
    });
    expect(res.json().summary.endedEarly).toBe(true);
    expect(res.json().summary.xp.total).toBe(0);

    plannedEndAt = new Date(Date.parse(t.clock.now) + 20 * 60_000).toISOString();
    start = await t.api({
      method: 'POST',
      url: '/api/sessions',
      payload: { nodeId: node.id, mode: 'scheduled', plannedEndAt },
    });
    advanceClock(t, 20);
    res = await t.api({
      method: 'POST',
      url: `/api/sessions/${start.json().active.session.id}/end`,
      payload: {},
    });
    expect(res.json().summary.endedEarly).toBe(false);
    expect(res.json().summary.xp.base).toBe(40);
  });
});

describe('a pomodoro with a planned end', () => {
  it('runs its intervals and then stops at the planned end', async () => {
    const t2 = await createTestApp('2026-09-21T14:00:00.000Z');
    const node = (
      await t2.api({ method: 'POST', url: '/api/nodes', payload: { title: 'Mixed' } })
    ).json().node;

    // 40 minutes cuts the second work block short: 25 work, 5 break, then 10 of 25.
    const plannedEndAt = new Date(Date.parse(t2.clock.now) + 40 * 60_000).toISOString();
    const start = await t2.api({
      method: 'POST',
      url: '/api/sessions',
      payload: { nodeId: node.id, mode: 'pomodoro', plannedEndAt },
    });
    expect(start.statusCode).toBe(201);
    const s = start.json().active.session;
    expect(s.mode).toBe('pomodoro');
    expect(s.plannedEndAt).toBe(plannedEndAt);
    // The first interval still ends at the work length, not at the planned end.
    expect(start.json().active.timer.phaseEndsAt).toBe(
      new Date(Date.parse('2026-09-21T14:00:00.000Z') + 25 * 60_000).toISOString(),
    );

    // Past the planned end plus the grace period, the session has closed itself.
    advanceClock(t2, 42);
    const active = await t2.api({ method: 'GET', url: '/api/sessions/active' });
    expect(active.json().active).toBeNull();

    const list = await t2.api({ method: 'GET', url: `/api/sessions?nodeId=${node.id}` });
    const done = list.json().sessions[0];
    expect(done.endedAt).toBe(plannedEndAt);
    // It ran to the end it promised, so it is not an early finish and XP is paid.
    expect(done.xpAwarded).toBeGreaterThan(0);
    await t2.close();
  });

  it('pays a pomodoro with a planned end that is stopped early but held ten minutes', async () => {
    const t2 = await createTestApp('2026-09-21T14:00:00.000Z');
    const node = (
      await t2.api({ method: 'POST', url: '/api/nodes', payload: { title: 'Bailed' } })
    ).json().node;
    const plannedEndAt = new Date(Date.parse(t2.clock.now) + 60 * 60_000).toISOString();
    const s = (
      await t2.api({
        method: 'POST',
        url: '/api/sessions',
        payload: { nodeId: node.id, mode: 'pomodoro', plannedEndAt },
      })
    ).json().active.session.id;
    advanceClock(t2, 30); // a full work interval, but well short of the hour promised
    const end = await t2.api({
      method: 'POST',
      url: `/api/sessions/${s}/end`,
      payload: { review: { skipped: true } },
    });
    expect(end.json().summary.endedEarly).toBe(true);
    expect(end.json().summary.xp.withheld).toBe(false);
    expect(end.json().summary.xp.base).toBe(50);
    await t2.close();
  });

  it('refuses a planned end in the past for either style', async () => {
    const t2 = await createTestApp('2026-09-21T14:00:00.000Z');
    const node = (
      await t2.api({ method: 'POST', url: '/api/nodes', payload: { title: 'Past' } })
    ).json().node;
    const past = new Date(Date.parse(t2.clock.now) - 60_000).toISOString();
    for (const mode of ['pomodoro', 'scheduled']) {
      const res = await t2.api({
        method: 'POST',
        url: '/api/sessions',
        payload: { nodeId: node.id, mode, plannedEndAt: past },
      });
      expect(res.statusCode).toBe(400);
    }
    await t2.close();
  });

  it('records a finished session on the calendar as study that happened', async () => {
    const t2 = await createTestApp('2026-09-21T14:00:00.000Z');
    const node = (
      await t2.api({ method: 'POST', url: '/api/nodes', payload: { title: 'Reading' } })
    ).json().node;
    const s = (
      await t2.api({
        method: 'POST',
        url: '/api/sessions',
        payload: { nodeId: node.id, mode: 'pomodoro' },
      })
    ).json().active.session.id;
    advanceClock(t2, 25);
    await t2.api({
      method: 'POST',
      url: `/api/sessions/${s}/end`,
      payload: { review: { skipped: true } },
    });

    const blocks = (await t2.api({ method: 'GET', url: '/api/planned-blocks' })).json().blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      nodeId: node.id,
      source: 'session',
      sessionId: s,
      startAt: '2026-09-21T14:00:00.000Z',
    });

    // Logged study is not "time set aside": it has already happened.
    const pace = await t2.api({ method: 'GET', url: '/api/pace' });
    expect(pace.json().plannedMinutes[node.id]).toBe(0);
    await t2.close();
  });

  it('does not touch the calendar when session logging is off', async () => {
    const t2 = await createTestApp('2026-09-21T14:00:00.000Z');
    await t2.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { calendar: { logSessions: false } },
    });
    const node = (
      await t2.api({ method: 'POST', url: '/api/nodes', payload: { title: 'Quiet' } })
    ).json().node;
    const s = (
      await t2.api({
        method: 'POST',
        url: '/api/sessions',
        payload: { nodeId: node.id, mode: 'pomodoro' },
      })
    ).json().active.session.id;
    advanceClock(t2, 25);
    await t2.api({
      method: 'POST',
      url: `/api/sessions/${s}/end`,
      payload: { review: { skipped: true } },
    });
    expect((await t2.api({ method: 'GET', url: '/api/planned-blocks' })).json().blocks).toEqual([]);
    await t2.close();
  });
});
