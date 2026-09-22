import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp('2026-09-21T14:00:00.000Z');
  await t.api({ method: 'GET', url: '/api/me' });
});
afterAll(() => t.close());

const grades = () => t.api({ method: 'GET', url: '/api/grades' });
const component = (payload: Record<string, unknown>) =>
  t.api({ method: 'POST', url: '/api/grades/components', payload });

describe('grades', () => {
  let eco = '';
  let sta = '';
  let midterm = '';

  it('starts with no courses to grade', async () => {
    const res = await grades();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ courses: [], gpa: { points: null, courseCount: 0 } });
  });

  it('lists a course with no grade yet', async () => {
    eco = (
      await t.api({
        method: 'POST',
        url: '/api/nodes',
        payload: { title: 'ECO220', kind: 'course' },
      })
    ).json().node.id;
    const body = await grades().then((r) => r.json());
    expect(body.courses).toHaveLength(1);
    expect(body.courses[0].grade).toMatchObject({ percent: null, letter: null, weightTotal: 0 });
  });

  it('adds weighted components and rescales to the weight graded', async () => {
    const res = await component({ nodeId: eco, title: 'Midterm', weight: 30, score: 88 });
    expect(res.statusCode).toBe(201);
    midterm = res.json().component.id;
    await component({ nodeId: eco, title: 'Final', weight: 70 });

    const course = (await grades().then((r) => r.json())).courses[0];
    expect(course.grade).toMatchObject({
      percent: 88,
      weightGraded: 30,
      weightTotal: 100,
      letter: 'A',
      points: 4,
    });
  });

  it('updates a score', async () => {
    await t.api({
      method: 'PATCH',
      url: `/api/grades/components/${midterm}`,
      payload: { score: 62 },
    });
    const course = (await grades().then((r) => r.json())).courses[0];
    expect(course.grade.percent).toBeCloseTo(62);
    expect(course.grade.letter).toBe('C-'); // 60-62 on the U of T scale
  });

  it('takes a single overall mark instead when the course says so', async () => {
    sta = (
      await t.api({
        method: 'POST',
        url: '/api/nodes',
        payload: { title: 'STA257', kind: 'course' },
      })
    ).json().node.id;
    await t.api({
      method: 'PATCH',
      url: `/api/nodes/${sta}`,
      payload: { gradeMode: 'overall', gradeOverall: 91 },
    });
    const body = await grades().then((r) => r.json());
    const course = body.courses.find((c: { node: { id: string } }) => c.node.id === sta);
    expect(course.grade).toMatchObject({ mode: 'overall', percent: 91, letter: 'A+', points: 4 });
  });

  it('averages grade points across courses', async () => {
    const body = await grades().then((r) => r.json());
    // ECO220 at 62 (C-, 1.7) and STA257 at 91 (A+, 4.0).
    expect(body.gpa.courseCount).toBe(2);
    expect(body.gpa.points).toBeCloseTo(2.85);
  });

  it('weights the average by credits', async () => {
    await t.api({ method: 'PATCH', url: `/api/nodes/${sta}`, payload: { gradeCredits: 0.5 } });
    const body = await grades().then((r) => r.json());
    expect(body.gpa.points).toBeCloseTo((1.7 * 1 + 4 * 0.5) / 1.5);
  });

  it('follows a custom grading scale from settings', async () => {
    await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: {
        grading: {
          scale: [
            { minPercent: 80, letter: 'Pass', points: 4 },
            { minPercent: 0, letter: 'Fail', points: 0 },
          ],
        },
      },
    });
    const body = await grades().then((r) => r.json());
    const course = body.courses.find((c: { node: { id: string } }) => c.node.id === sta);
    expect(course.grade.letter).toBe('Pass');
  });

  it('rejects a component on a course that is not yours', async () => {
    await t.api({ method: 'GET', url: '/api/me', token: t.tokenB });
    const res = await t.api({
      method: 'POST',
      url: '/api/grades/components',
      payload: { nodeId: eco, title: 'Sneaky', weight: 10 },
      token: t.tokenB,
    });
    expect(res.statusCode).toBe(404);
  });

  it('deletes a component', async () => {
    const res = await t.api({ method: 'DELETE', url: `/api/grades/components/${midterm}` });
    expect(res.statusCode).toBe(204);
    const course = (await grades().then((r) => r.json())).courses.find(
      (c: { node: { id: string } }) => c.node.id === eco,
    );
    expect(course.components).toHaveLength(1);
    expect(course.grade.percent).toBeNull();
  });

  it('drops components with the course', async () => {
    await t.api({ method: 'DELETE', url: `/api/nodes/${eco}` });
    const body = await grades().then((r) => r.json());
    expect(body.courses.map((c: { node: { id: string } }) => c.node.id)).toEqual([sta]);
  });
});
