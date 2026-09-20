import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { advanceClock, createTestApp, type TestApp } from './helpers';

let t: TestApp;
let quizId: string;

beforeAll(async () => {
  // Tuesday 2026-09-15 10:00 Toronto
  t = await createTestApp('2026-09-15T14:00:00.000Z');
  const course = (
    await t.api({ method: 'POST', url: '/api/nodes', payload: { title: 'EAS101', kind: 'course' } })
  ).json().node;
  quizId = (
    await t.api({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        title: 'Quiz 1',
        kind: 'assessment',
        parentId: course.id,
        estimatedMinutes: 120,
        dueAt: '2026-09-16T16:00:00.000Z',
      },
    })
  ).json().node.id;
  // Two sessions: 30 min then 40 min with rising preparedness.
  for (const [minutes, prepared] of [
    [30, 2],
    [40, 4],
  ] as const) {
    const s = (
      await t.api({
        method: 'POST',
        url: '/api/sessions',
        payload: { nodeId: quizId, mode: 'unlimited' },
      })
    ).json().active.session.id;
    advanceClock(t, minutes);
    await t.api({
      method: 'POST',
      url: `/api/sessions/${s}/end`,
      payload: { review: { prepared, distracted: 'no' } },
    });
    advanceClock(t, 5);
  }
});
afterAll(() => t.close());

describe('analytics', () => {
  it('returns positive-only highlights for the current week', async () => {
    const res = await t.api({ method: 'GET', url: '/api/analytics/week' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.weekStart).toBe('2026-09-14');
    const keys = body.highlights.map((h: { key: string }) => h.key);
    expect(keys).toContain('hours-total');
    expect(keys).toContain('preparedness-up');
    expect(body.fallback).toBeNull();
    for (const h of body.highlights) expect(h.headline).not.toMatch(/!/);
  });

  it('falls back to a calm line for an empty week', async () => {
    const res = await t.api({ method: 'GET', url: '/api/analytics/week', token: t.tokenB });
    expect(res.json().highlights).toEqual([]);
    expect(res.json().fallback).toMatch(/Fresh week/);
  });

  it('returns advanced analytics per node and course', async () => {
    const res = await t.api({ method: 'GET', url: '/api/analytics/advanced' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const quiz = body.nodes.find((n: { nodeId: string }) => n.nodeId === quizId);
    expect(quiz.sessions).toHaveLength(2);
    expect(quiz.preparedness.map((p: { value: number }) => p.value)).toEqual([2, 4]);
    expect(quiz.distractionRate).toBe(0);
    expect(body.courses[0].title).toBe('EAS101');
    expect(body.courses[0].thisWeekTotal).toBe(70);
    expect(body.estimateAccuracy.samples).toEqual([]);
  });

  it('serves and saves the weekly review', async () => {
    let res = await t.api({ method: 'GET', url: '/api/analytics/weekly-review' });
    expect(res.json().review.actualMinutes).toBe(70);
    expect(res.json().review.sessions).toBe(2);
    expect(res.json().note).toBeNull();
    res = await t.api({
      method: 'PUT',
      url: '/api/analytics/weekly-review/2026-09-14',
      payload: { note: 'Start earlier.' },
    });
    expect(res.statusCode).toBe(200);
    res = await t.api({ method: 'GET', url: '/api/analytics/weekly-review?weekStart=2026-09-14' });
    expect(res.json().note).toBe('Start earlier.');
  });

  it('asks the post-assessment follow-up once, a day after the due date', async () => {
    let res = await t.api({ method: 'GET', url: '/api/follow-ups' });
    expect(res.json().followUps).toEqual([]);
    t.clock.now = '2026-09-17T14:00:00.000Z';
    res = await t.api({ method: 'GET', url: '/api/follow-ups' });
    expect(res.json().followUps.map((n: { id: string }) => n.id)).toEqual([quizId]);
    await t.api({ method: 'PATCH', url: `/api/nodes/${quizId}`, payload: { outcomeRating: 4 } });
    res = await t.api({ method: 'GET', url: '/api/follow-ups' });
    expect(res.json().followUps).toEqual([]);
  });

  it('dismisses a follow-up without a rating', async () => {
    const id = (
      await t.api({
        method: 'POST',
        url: '/api/nodes',
        payload: { title: 'Exam', kind: 'assessment', dueAt: '2026-09-15T16:00:00.000Z' },
      })
    ).json().node.id;
    let res = await t.api({ method: 'GET', url: '/api/follow-ups' });
    expect(res.json().followUps.map((n: { id: string }) => n.id)).toEqual([id]);
    await t.api({ method: 'POST', url: `/api/nodes/${id}/outcome-dismiss` });
    res = await t.api({ method: 'GET', url: '/api/follow-ups' });
    expect(res.json().followUps).toEqual([]);
  });
});
