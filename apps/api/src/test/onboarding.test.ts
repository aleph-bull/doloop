import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

it('finishes account setup without creating a course or task, then starts a free session', async () => {
  const initial = (await t.api({ method: 'GET', url: '/api/me' })).json();
  expect(initial.onboarded).toBe(false);
  expect(initial.user.settings.dashboard.focusOnly).toBe(false);
  const ready = await t.api({ method: 'PATCH', url: '/api/me', payload: { onboarded: true } });
  expect(ready.statusCode).toBe(200);
  expect(ready.json()).toMatchObject({
    onboarded: true,
    user: {
      settings: {
        dashboard: { focusOnly: true },
        focusScreen: { openOnStart: 'never' },
        timelapse: { record: 'never' },
        visualizer: { promptDismissed: true },
      },
    },
  });
  expect((await t.api({ method: 'GET', url: '/api/nodes' })).json().nodes).toEqual([]);
  const start = await t.api({
    method: 'POST',
    url: '/api/sessions',
    payload: { mode: 'unlimited' },
  });
  expect(start.statusCode).toBe(201);
  expect(start.json().active.session.nodeId).toBeNull();
});

it('persists revealing the full dashboard and does not reset choices on repeated setup', async () => {
  const update = await t.api({
    method: 'PATCH',
    url: '/api/me/settings',
    payload: {
      dashboard: { focusOnly: false },
      timelapse: { record: 'always' },
    },
  });
  expect(update.statusCode).toBe(200);
  await t.api({ method: 'PATCH', url: '/api/me', payload: { onboarded: true } });
  const saved = (await t.api({ method: 'GET', url: '/api/me' })).json();
  expect(saved.user.settings.dashboard.focusOnly).toBe(false);
  expect(saved.user.settings.timelapse.record).toBe('always');
});
