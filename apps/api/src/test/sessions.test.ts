import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

  it('applies events: skip break, idle, pause, resume', async () => {
    let res = await t.api({
      method: 'POST',
      url: `/api/sessions/${sessionId}/events`,
      payload: { type: 'skip-break' },
    });
    expect(res.json().active.timer.phase).toBe('work');
    advanceClock(t, 10);
    const idleSince = new Date(Date.parse(t.clock.now) - 5 * 60_000).toISOString();
    res = await t.api({
      method: 'POST',
      url: `/api/sessions/${sessionId}/events`,
      payload: { type: 'idle-start', idleSince },
    });
    expect(res.json().active.timer.phase).toBe('idle');
    advanceClock(t, 1);
    res = await t.api({
      method: 'POST',
      url: `/api/sessions/${sessionId}/events`,
      payload: { type: 'idle-answer', stillStudying: true },
    });
    expect(res.json().active.timer.phase).toBe('work');
    expect(res.json().active.view.idleSeconds).toBe(360);
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
    // work: 25 (first interval) + 5 (before idle) + 0 (paused right after idle) + 5 (after resume) = 35 min
    expect(summary.session.workSeconds).toBe(2100);
    expect(summary.session.breakSeconds).toBe(120);
    expect(summary.session.idleSeconds).toBe(360);
    expect(summary.session.review).toMatchObject({
      skipped: false,
      distracted: 'no',
      mood: 4,
      note: 'good',
    });
    // 35 focused minutes -> 70 base; review 10%, focus 20%, streak day 1
    expect(summary.xp.base).toBe(70);
    expect(summary.xp.reviewSubmitted).toBe(7);
    expect(summary.xp.focus).toBe(14);
    expect(summary.streak.current).toBe(1);
    expect(summary.xp.streakBonus).toBe(1);
    expect(summary.endedEarly).toBe(false);
    expect(summary.phrase).not.toBeNull();
    expect(summary.isFirstSessionOnNode).toBe(true);
    expect(summary.confetti).toBe(true);
    expect(summary.xpTotal).toBe(summary.xp.total);

    const nodesRes = await t.api({ method: 'GET', url: '/api/nodes' });
    const hw = nodesRes.json().nodes.find((n: { id: string }) => n.id === hwId);
    expect(hw.estimatedMinutes).toBe(180);

    const me = await t.api({ method: 'GET', url: '/api/me' });
    expect(me.json().user.xp).toBe(summary.xp.total);
    expect(me.json().user.streak.current).toBe(1);

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
    expect(pace[hwId].loggedWorkMinutes).toBe(35);
    expect(pace[hwId].remainingMinutes).toBe(145);
    expect(pace[courseId].aggregated).toBe(true);
    expect(pace[courseId].loggedWorkMinutes).toBe(35);
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

  it('"still studying? no" ends and finalizes the session', async () => {
    advanceClock(t, 60);
    const start = await t.api({
      method: 'POST',
      url: '/api/sessions',
      payload: { nodeId: hwId, mode: 'unlimited' },
    });
    const id = start.json().active.session.id;
    advanceClock(t, 30);
    await t.api({
      method: 'POST',
      url: `/api/sessions/${id}/events`,
      payload: { type: 'idle-start', idleSince: t.clock.now },
    });
    advanceClock(t, 2);
    const res = await t.api({
      method: 'POST',
      url: `/api/sessions/${id}/events`,
      payload: { type: 'idle-answer', stillStudying: false },
    });
    expect(res.json().active.timer.phase).toBe('ended');
    const active = await t.api({ method: 'GET', url: '/api/sessions/active' });
    expect(active.json().active).toBeNull();
    const s = await t.api({ method: 'GET', url: `/api/sessions/${id}` });
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
    expect(list.length).toBe(5);
    for (let i = 1; i < list.length; i++)
      expect(list[i - 1].startedAt >= list[i].startedAt).toBe(true);
  });
});

describe('early cancellation', () => {
  it('a pomodoro ended before its first work interval earns no XP', async () => {
    const node = (
      await t.api({ method: 'POST', url: '/api/nodes', payload: { title: 'Early' } })
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
    expect(summary.xp.total).toBe(0);
    expect(summary.xp.withheld).toBe(true);
    expect(summary.confetti).toBe(false);
    expect(summary.session.workSeconds).toBe(600);
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
    advanceClock(t, 15);
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
