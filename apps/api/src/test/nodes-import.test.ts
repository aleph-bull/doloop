import type { StudyNode } from '@komogon/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const list = async (token?: string): Promise<StudyNode[]> =>
  (await t.api({ method: 'GET', url: '/api/nodes', token })).json().nodes;

const LIST = {
  courses: [
    {
      title: 'MAT137',
      items: [
        {
          title: 'Problem set 3',
          kind: 'task',
          dueAt: '2026-11-05T04:59:00.000Z',
          estimatedMinutes: 180,
        },
        { title: 'Midterm 1', kind: 'assessment', dueAt: '2026-11-12T19:00:00.000Z' },
      ],
    },
    { title: 'ECO101', items: [{ title: 'Read chapter 4', kind: 'task', dueAt: null }] },
  ],
};

it('adds courses and their items in one go', async () => {
  const res = await t.api({ method: 'POST', url: '/api/nodes/import', payload: LIST });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ courses: 2, items: 3, skipped: 0 });

  const nodes = await list();
  const mat = nodes.find((n) => n.title === 'MAT137')!;
  expect(mat).toMatchObject({ kind: 'course', parentId: null });
  const under = nodes
    .filter((n) => n.parentId === mat.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  expect(under.map((n) => [n.title, n.kind, n.dueAt, n.estimatedMinutes])).toEqual([
    ['Problem set 3', 'task', '2026-11-05T04:59:00.000Z', 180],
    ['Midterm 1', 'assessment', '2026-11-12T19:00:00.000Z', null],
  ]);
  // The new items show up in pace like any other, estimate and all.
  const pace = (await t.api({ method: 'GET', url: '/api/pace' })).json().pace;
  expect(pace[under[0]!.id].estimatedMinutes).toBe(180);
});

it('adds nothing the second time the same list is pasted', async () => {
  const res = await t.api({ method: 'POST', url: '/api/nodes/import', payload: LIST });
  expect(res.json()).toEqual({ courses: 0, items: 0, skipped: 3 });
  expect(await list()).toHaveLength(5);
});

it('puts new items under a course that is already there, however its code is written', async () => {
  const res = await t.api({
    method: 'POST',
    url: '/api/nodes/import',
    payload: {
      courses: [
        { title: 'mat 137', items: [{ title: 'Problem set 4', kind: 'task' }] },
        { title: 'Chemistry', items: [] },
      ],
    },
  });
  expect(res.json()).toEqual({ courses: 1, items: 1, skipped: 0 });
  const nodes = await list();
  expect(nodes.filter((n) => n.kind === 'course').map((n) => n.title)).toEqual([
    'MAT137',
    'ECO101',
    'Chemistry',
  ]);
  const mat = nodes.find((n) => n.title === 'MAT137')!;
  const four = nodes.find((n) => n.title === 'Problem set 4')!;
  expect(four.parentId).toBe(mat.id);
});

it("keeps to the account's own courses", async () => {
  const res = await t.api({
    method: 'POST',
    url: '/api/nodes/import',
    token: t.tokenB,
    payload: { courses: [{ title: 'MAT137', items: [{ title: 'Problem set 3', kind: 'task' }] }] },
  });
  expect(res.json()).toEqual({ courses: 1, items: 1, skipped: 0 });
  expect(await list(t.tokenB)).toHaveLength(2);
  expect(await list()).toHaveLength(7);
});

it('refuses an empty list and one over the item limit', async () => {
  const empty = await t.api({ method: 'POST', url: '/api/nodes/import', payload: { courses: [] } });
  expect(empty.statusCode).toBe(400);
  const items = Array.from({ length: 251 }, (_, i) => ({ title: `Item ${i}`, kind: 'task' }));
  const big = await t.api({
    method: 'POST',
    url: '/api/nodes/import',
    payload: {
      courses: [
        { title: 'A100', items },
        { title: 'B100', items },
      ],
    },
  });
  expect(big.statusCode).toBe(400);
  expect(await list()).toHaveLength(7);
});
