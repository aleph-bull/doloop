import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestApp, USER_A, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp(undefined, { adminEmails: [USER_A.email] });
});
afterAll(() => t.close());

it('keeps the answers as they come, skipped questions as null', async () => {
  const empty = await t.api({ method: 'GET', url: '/api/me/onboarding' });
  expect(empty.json()).toEqual({ answers: {} });

  await t.api({
    method: 'PATCH',
    url: '/api/me/onboarding',
    payload: { look: { id: 'minimalist', dark: true }, university: 'waterloo' },
  });
  await t.api({
    method: 'PATCH',
    url: '/api/me/onboarding',
    payload: { uses: ['study', 'journal', 'study'], apps: null, sections: { questions: 'done' } },
  });
  const res = await t.api({
    method: 'PATCH',
    url: '/api/me/onboarding',
    payload: { sections: { tour: 'skipped' }, addTasks: false },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().answers).toEqual({
    look: { id: 'minimalist', dark: true },
    university: 'waterloo',
    uses: ['study', 'journal'],
    apps: null,
    sections: { questions: 'done', tour: 'skipped' },
    addTasks: false,
  });
});

it('turns away answers that are not on the lists', async () => {
  for (const payload of [
    { university: 'harvard' },
    { uses: ['sleep'] },
    { look: { id: 'neon', dark: false } },
    { favourite: 'pizza' },
  ]) {
    const res = await t.api({ method: 'PATCH', url: '/api/me/onboarding', payload });
    expect(res.statusCode).toBe(400);
  }
  const ok = await t.api({
    method: 'PATCH',
    url: '/api/me/onboarding',
    payload: { university: 'none' },
  });
  expect(ok.statusCode).toBe(200);
});

it('shows everyone’s answers to an admin only', async () => {
  await t.api({
    method: 'PATCH',
    url: '/api/me/onboarding',
    token: t.tokenB,
    payload: { apps: ['notion'] },
  });
  const list = await t.api({ method: 'GET', url: '/api/admin/onboarding' });
  expect(list.statusCode).toBe(200);
  const rows = list.json().answers as Array<{ email: string; answers: unknown }>;
  expect(rows.map((r) => r.email).sort()).toEqual(['a@example.com', 'b@example.com']);
  expect(rows.find((r) => r.email === 'b@example.com')!.answers).toEqual({ apps: ['notion'] });

  const refused = await t.api({ method: 'GET', url: '/api/admin/onboarding', token: t.tokenB });
  expect(refused.statusCode).toBe(403);
});
