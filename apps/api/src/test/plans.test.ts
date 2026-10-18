import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { advanceClock, createTestApp, type TestApp } from './helpers';

const TECHNICALS = {
  title: 'IB technicals',
  weeklyMinutes: 22 * 60,
  targetDate: '2026-10-09',
  method:
    'Warm up 15-20 min of notes, cold drill out loud, re-read only the misses, redo misses tomorrow.',
  topics: [
    {
      title: 'Accounting / 3 statements',
      plannedMinutes: 480,
      resource: 'BIWS Mod 2-4',
      practice: true,
    },
    {
      title: 'Equity Value & Enterprise Value',
      plannedMinutes: 300,
      resource: 'BIWS Mod 6',
      practice: true,
    },
    { title: 'Mixed timed mock drills', plannedMinutes: 360, resource: 'All', practice: false },
  ],
  maintenance: { title: 'Re-drill misses + market news', minutes: 15 },
};

describe('study plans', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp('2026-09-21T14:00:00.000Z');
  });
  afterEach(async () => t.close());

  async function create() {
    const res = await t.api({ method: 'POST', url: '/api/plans', payload: TECHNICALS });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  it('creates a plan whose topics are ordinary tasks under it', async () => {
    const view = await create();
    expect(view.plan.title).toBe('IB technicals');
    expect(view.plan.startedOn).toBe('2026-09-21');
    expect(view.plan.targetDate).toBe('2026-10-09');
    expect(view.topics.map((x: { state: string }) => x.state)).toEqual([
      'up-next',
      'not-started',
      'not-started',
    ]);
    expect(view.pacing.plannedMinutes).toBe(1140);
    expect(view.maintenance.title).toBe('Re-drill misses + market news');

    const nodes = (await t.api({ method: 'GET', url: '/api/nodes' })).json().nodes;
    const root = nodes.find((n: { id: string }) => n.id === view.plan.id);
    expect(root).toMatchObject({ kind: 'course', gradeMode: 'off', parentId: null });
    expect(nodes.filter((n: { parentId: string }) => n.parentId === view.plan.id)).toHaveLength(3);

    const list = (await t.api({ method: 'GET', url: '/api/plans' })).json().plans;
    expect(list).toHaveLength(1);
    expect(list[0].upNext.title).toBe('Accounting / 3 statements');
  });

  it('counts sessions on a topic as plan hours', async () => {
    const view = await create();
    const topicId = view.topics[0].topic.id;
    const start = await t.api({
      method: 'POST',
      url: '/api/sessions',
      payload: { nodeId: topicId, mode: 'unlimited' },
    });
    expect(start.statusCode).toBeLessThan(300);
    advanceClock(t, 50);
    const sid = start.json().active.session.id;
    const stop = await t.api({
      method: 'POST',
      url: `/api/sessions/${sid}/end`,
      payload: { review: { skipped: true } },
    });
    expect(stop.statusCode).toBeLessThan(300);
    const after = (await t.api({ method: 'GET', url: `/api/plans/${view.plan.id}` })).json();
    expect(Math.round(after.topics[0].loggedMinutes)).toBe(50);
    expect(after.topics[0].state).toBe('in-progress');
    expect(Math.round(after.pacing.thisWeekMinutes)).toBe(50);
    expect(Math.round(after.totals.minutes)).toBe(50);
    expect(after.streak).toBe(1);
  });

  it('queues misses for tomorrow and masters a topic once they are redone', async () => {
    const view = await create();
    const topicId = view.topics[0].topic.id;
    const first = await t.api({
      method: 'POST',
      url: `/api/plan-topics/${topicId}/drills`,
      payload: { ok: 17, shaky: 0, miss: 1, misses: ['Walk a $10 depreciation change through'] },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().mastered).toBeNull();
    expect(first.json().view.queue).toHaveLength(0);
    expect(first.json().view.laterCount).toBe(1);

    advanceClock(t, 24 * 60);
    const second = (
      await t.api({
        method: 'POST',
        url: `/api/plan-topics/${topicId}/drills`,
        payload: { ok: 20, shaky: 0, miss: 0 },
      })
    ).json();
    // Accuracy is there, but yesterday's miss has not been redone.
    expect(second.mastered).toBeNull();
    expect(second.view.queue).toHaveLength(1);

    const itemId = second.view.queue[0].id;
    const answered = (
      await t.api({
        method: 'POST',
        url: `/api/drill-items/${itemId}/answer`,
        payload: { result: 'ok' },
      })
    ).json();
    expect(answered.mastered.title).toBe('Accounting / 3 statements');
    expect(answered.view.topics[0].state).toBe('mastered');
    expect(answered.view.topics[1].state).toBe('up-next');
    expect(answered.view.milestones).toHaveLength(1);
    expect(answered.view.totals.answers).toBe(38);
  });

  it('offers to rebalance when the budget no longer covers the target', async () => {
    const view = await create();
    // Two weeks pass with nothing done; the target is now days away.
    advanceClock(t, 14 * 24 * 60);
    const later = (await t.api({ method: 'GET', url: `/api/plans/${view.plan.id}` })).json();
    expect(later.pacing.status).toBe('behind');
    expect(later.rebalance.raiseWeeklyTo).toBeGreaterThan(22 * 60);
    const moved = await t.api({
      method: 'PATCH',
      url: `/api/plans/${view.plan.id}`,
      payload: { targetDate: later.rebalance.moveTargetTo },
    });
    expect(moved.json().pacing.status).not.toBe('behind');
  });

  it('keeps plans to their owner', async () => {
    const view = await create();
    const res = await t.api({ method: 'GET', url: `/api/plans/${view.plan.id}`, token: t.tokenB });
    expect(res.statusCode).toBe(404);
    const drill = await t.api({
      method: 'POST',
      url: `/api/plan-topics/${view.topics[0].topic.id}/drills`,
      token: t.tokenB,
      payload: { ok: 1, shaky: 0, miss: 0 },
    });
    expect(drill.statusCode).toBe(404);
  });

  it('deletes a plan with its topics and its top-up routine', async () => {
    const view = await create();
    const del = await t.api({ method: 'DELETE', url: `/api/plans/${view.plan.id}` });
    expect(del.statusCode).toBe(204);
    const nodes = (await t.api({ method: 'GET', url: '/api/nodes' })).json().nodes;
    expect(nodes).toHaveLength(0);
    const routines = (await t.api({ method: 'GET', url: '/api/routines/list' })).json();
    expect(JSON.stringify(routines)).not.toContain('market news');
  });
});
