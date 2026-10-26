import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp('2026-09-20T18:00:00.000Z'); // Sunday 14:00 Toronto
});
afterAll(() => t.close());

describe('nodes', () => {
  it('keeps a template for the items under a node, and clears it', async () => {
    const course = (
      await t.api({
        method: 'POST',
        url: '/api/nodes',
        payload: {
          title: 'Templated',
          kind: 'course',
          childDefaults: { kind: 'assessment', estimatedMinutes: 90, dueTime: '17:00' },
        },
      })
    ).json().node;
    // Unset fields come back null, so a client can read every key.
    expect(course.childDefaults).toEqual({
      kind: 'assessment',
      estimatedMinutes: 90,
      dueTime: '17:00',
      countUnit: null,
      countUnitLabel: null,
      color: null,
    });
    const plain = (
      await t.api({ method: 'POST', url: '/api/nodes', payload: { title: 'Plain' } })
    ).json().node;
    expect(plain.childDefaults).toBeNull();

    const changed = await t.api({
      method: 'PATCH',
      url: `/api/nodes/${course.id}`,
      payload: { childDefaults: { countUnit: 'pages', color: '#ff0000' } },
    });
    expect(changed.json().node.childDefaults).toMatchObject({
      kind: null,
      countUnit: 'pages',
      color: '#ff0000',
    });
    const bad = await t.api({
      method: 'PATCH',
      url: `/api/nodes/${course.id}`,
      payload: { childDefaults: { dueTime: 'five' } },
    });
    expect(bad.statusCode).toBe(400);
    const cleared = await t.api({
      method: 'PATCH',
      url: `/api/nodes/${course.id}`,
      payload: { childDefaults: null },
    });
    expect(cleared.json().node.childDefaults).toBeNull();
    // The template never touches the node's own fields.
    expect(cleared.json().node.estimatedMinutes).toBeNull();
    for (const id of [course.id, plain.id])
      await t.api({ method: 'DELETE', url: `/api/nodes/${id}` });
  });

  it('creates a tree, rejects cycles, archives subtrees', async () => {
    const course = (
      await t.api({ method: 'POST', url: '/api/nodes', payload: { title: 'C', kind: 'course' } })
    ).json().node;
    const unit = (
      await t.api({
        method: 'POST',
        url: '/api/nodes',
        payload: { title: 'U', parentId: course.id },
      })
    ).json().node;
    const task = (
      await t.api({
        method: 'POST',
        url: '/api/nodes',
        payload: { title: 'T', parentId: unit.id, estimatedMinutes: 30 },
      })
    ).json().node;

    const cycle = await t.api({
      method: 'PATCH',
      url: `/api/nodes/${course.id}`,
      payload: { parentId: task.id },
    });
    expect(cycle.statusCode).toBe(400);
    const self = await t.api({
      method: 'PATCH',
      url: `/api/nodes/${course.id}`,
      payload: { parentId: course.id },
    });
    expect(self.statusCode).toBe(400);

    const bogus = await t.api({
      method: 'POST',
      url: '/api/nodes',
      payload: { title: 'X', parentId: '33333333-3333-4333-8333-333333333333' },
    });
    expect(bogus.statusCode).toBe(404);

    const archived = await t.api({ method: 'POST', url: `/api/nodes/${unit.id}/archive` });
    expect(archived.json().archivedIds.sort()).toEqual([unit.id, task.id].sort());
    const list = (await t.api({ method: 'GET', url: '/api/nodes' })).json().nodes;
    expect(list.map((n: { id: string }) => n.id)).toEqual([course.id]);
    const all = (await t.api({ method: 'GET', url: '/api/nodes?archived=true' })).json().nodes;
    expect(all.length).toBe(3);

    const deleted = await t.api({ method: 'DELETE', url: `/api/nodes/${course.id}` });
    expect(deleted.statusCode).toBe(204);
  });

  it('logs estimate edits and unknown keys are rejected', async () => {
    const n = (
      await t.api({
        method: 'POST',
        url: '/api/nodes',
        payload: { title: 'E', estimatedMinutes: 60 },
      })
    ).json().node;
    const ok = await t.api({
      method: 'PATCH',
      url: `/api/nodes/${n.id}`,
      payload: { estimatedMinutes: 90 },
    });
    expect(ok.json().node.estimatedMinutes).toBe(90);
    const bad = await t.api({ method: 'PATCH', url: `/api/nodes/${n.id}`, payload: { nope: 1 } });
    expect(bad.statusCode).toBe(400);
    const changes = await t.db.query.estimateChanges.findMany();
    expect(changes.filter((c) => c.nodeId === n.id).map((c) => c.toMinutes)).toEqual([60, 90]);
  });

  it('marks the subtasks done with their parent, and reopens only those', async () => {
    const make = async (title: string, parentId?: string) =>
      (await t.api({ method: 'POST', url: '/api/nodes', payload: { title, parentId } })).json().node
        .id as string;
    const done = (id: string, completedAt: string | null) =>
      t.api({ method: 'PATCH', url: `/api/nodes/${id}`, payload: { completedAt } });
    const state = async () => {
      const list = (await t.api({ method: 'GET', url: '/api/nodes' })).json().nodes as Array<{
        id: string;
        completedAt: string | null;
      }>;
      return new Map(list.map((n) => [n.id, n.completedAt]));
    };
    const parent = await make('Essay');
    const a = await make('Outline', parent);
    const b = await make('Draft', parent);
    const deep = await make('Intro', b);
    const early = await make('Sources', parent);
    await done(early, '2026-09-19T12:00:00.000Z');

    await done(parent, '2026-09-20T18:00:00.000Z');
    let s = await state();
    for (const id of [a, b, deep]) expect(s.get(id)).toBe('2026-09-20T18:00:00.000Z');
    // Finished on its own before, so it keeps its own date.
    expect(s.get(early)).toBe('2026-09-19T12:00:00.000Z');

    // Unticking a subtask leaves the parent done.
    await done(a, null);
    s = await state();
    expect(s.get(a)).toBeNull();
    expect(s.get(parent)).toBe('2026-09-20T18:00:00.000Z');

    // Reopening the parent reopens what was finished with it, nothing else.
    await done(parent, null);
    s = await state();
    for (const id of [parent, a, b, deep]) expect(s.get(id)).toBeNull();
    expect(s.get(early)).toBe('2026-09-19T12:00:00.000Z');
    await t.api({ method: 'DELETE', url: `/api/nodes/${parent}` });
  });

  it('leaves kind alone when a patch does not mention it', async () => {
    // The create schema defaults kind to 'task'. That default must not survive into the
    // patch schema, or renaming a course would quietly demote it to a task.
    const course = (
      await t.api({
        method: 'POST',
        url: '/api/nodes',
        payload: { title: 'ECO220', kind: 'course' },
      })
    ).json().node;
    const renamed = await t.api({
      method: 'PATCH',
      url: `/api/nodes/${course.id}`,
      payload: { title: 'ECO220H1' },
    });
    expect(renamed.json().node).toMatchObject({ title: 'ECO220H1', kind: 'course' });
    await t.api({ method: 'DELETE', url: `/api/nodes/${course.id}` });
  });
});

describe('settings and profile', () => {
  it('merges partial settings and rejects unknown keys', async () => {
    const res = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { pomodoro: { workMin: 50 }, review: { mode: 'full' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings.pomodoro.workMin).toBe(50);
    expect(res.json().settings.pomodoro.shortBreakMin).toBe(5);
    expect(res.json().settings.review.mode).toBe('full');
    const again = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { pomodoro: { shortBreakMin: 10 } },
    });
    expect(again.json().settings.pomodoro.workMin).toBe(50);
    expect(again.json().settings.pomodoro.shortBreakMin).toBe(10);
    const bad = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { hacker: true },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('goes to Social after a session unless turned off', async () => {
    const before = (await t.api({ method: 'GET', url: '/api/me' })).json().user.settings.review;
    expect(before.openSocial).toBe(true);
    const off = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { review: { openSocial: false } },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().settings.review).toMatchObject({ mode: before.mode, openSocial: false });
    const bad = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { review: { openSocial: 'yes' } },
    });
    expect(bad.statusCode).toBe(400);
    await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { review: { openSocial: true } },
    });
  });

  it('keeps the glass settings, starting at the light frost', async () => {
    const before = (await t.api({ method: 'GET', url: '/api/me' })).json().user.settings.theme;
    expect(before).toMatchObject({
      glassColor: null,
      glassAlpha: null,
      glassBlur: 11,
      glassSaturate: 100,
      // The photo itself starts sharp and as it is.
      backgroundBlur: 0,
      backgroundBrightness: 0,
    });
    const res = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { theme: { glassColor: '#2c2c3e', glassAlpha: 0.65, glassBlur: 6 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings.theme).toMatchObject({
      glassColor: '#2c2c3e',
      glassAlpha: 0.65,
      glassBlur: 6,
      glassSaturate: 100,
    });
    const back = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { theme: { glassColor: null, glassAlpha: null } },
    });
    expect(back.json().settings.theme).toMatchObject({ glassColor: null, glassAlpha: null });
    const photo = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { theme: { backgroundBlur: 12, backgroundBrightness: -30 } },
    });
    expect(photo.json().settings.theme).toMatchObject({
      backgroundBlur: 12,
      backgroundBrightness: -30,
    });
    for (const theme of [
      { glassBlur: 41 },
      { glassSaturate: 99 },
      { backgroundBlur: 41 },
      { backgroundBrightness: 61 },
      { backgroundBrightness: 2.5 },
      { glassAlpha: 0.2 },
      { glassColor: 'red' },
    ]) {
      const bad = await t.api({ method: 'PATCH', url: '/api/me/settings', payload: { theme } });
      expect(bad.statusCode).toBe(400);
    }
  });

  it('keeps the fonts, starting on the default', async () => {
    const before = (await t.api({ method: 'GET', url: '/api/me' })).json().user.settings.theme;
    expect(before).toMatchObject({
      fontText: 'default',
      fontHeading: 'default',
      fontTimer: 'default',
    });
    const own = 'upload:3f2b8c1e-6a4d-4b7e-9c2a-1d5e8f0a7b36';
    const res = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { theme: { fontText: 'lora', fontTimer: own } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings.theme).toMatchObject({
      fontText: 'lora',
      fontHeading: 'default',
      fontTimer: own,
    });
    for (const theme of [
      { fontText: 'comic-sans' },
      { fontHeading: 'upload:nope' },
      { fontTimer: 'https://example.com/font.woff2' },
    ]) {
      const bad = await t.api({ method: 'PATCH', url: '/api/me/settings', payload: { theme } });
      expect(bad.statusCode).toBe(400);
    }
    await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { theme: { fontText: 'default', fontTimer: 'default' } },
    });
  });

  it('keeps a texture, starting with none', async () => {
    const before = (await t.api({ method: 'GET', url: '/api/me' })).json().user.settings.theme;
    expect(before.texture).toBe('none');
    const res = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { theme: { backgroundId: 'solid:#f4f1ea', panel: 'matte', texture: 'grain' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings.theme).toMatchObject({ texture: 'grain', panel: 'matte' });
    const bad = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { theme: { texture: 'stripes' } },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('updates timezone and onboarding, regenerates ics token, exports data', async () => {
    const res = await t.api({
      method: 'PATCH',
      url: '/api/me',
      payload: { timezone: 'Europe/Berlin', onboarded: true },
    });
    expect(res.json().user.timezone).toBe('Europe/Berlin');
    expect(res.json().onboarded).toBe(true);
    expect(
      (await t.api({ method: 'PATCH', url: '/api/me', payload: { timezone: 'Nope/Nope' } }))
        .statusCode,
    ).toBe(400);
    const tok = await t.api({ method: 'POST', url: '/api/me/ics-token' });
    expect(tok.json().icsToken.length).toBeGreaterThan(20);
    const exp = await t.api({ method: 'GET', url: '/api/me/export' });
    expect(exp.statusCode).toBe(200);
    expect(exp.json().user.email).toBe('a@example.com');
    expect(Array.isArray(exp.json().nodes)).toBe(true);
  });
});

describe('rest days', () => {
  it('schedules weekly changes, enforces vacation lead time and the edit limit', async () => {
    // user A is now in Europe/Berlin; Sunday 20:00 local
    let res = await t.api({
      method: 'PUT',
      url: '/api/rest-days/weekly',
      payload: { days: [0, 6] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().policy.pendingWeeklyRestDays).toEqual({
      days: [0, 6],
      effectiveFrom: '2026-09-21',
    });
    expect(res.json().editsRemaining).toBe(2);

    res = await t.api({
      method: 'POST',
      url: '/api/rest-days/vacations',
      payload: { from: '2026-09-21', to: '2026-09-22', label: 'soon' },
    });
    expect(res.statusCode).toBe(400);
    res = await t.api({
      method: 'POST',
      url: '/api/rest-days/vacations',
      payload: { from: '2026-10-01', to: '2026-10-03', label: 'trip' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().editsRemaining).toBe(1);

    res = await t.api({ method: 'PUT', url: '/api/rest-days/weekly', payload: { days: [3] } });
    expect(res.json().editsRemaining).toBe(0);
    res = await t.api({ method: 'PUT', url: '/api/rest-days/weekly', payload: { days: [4] } });
    expect(res.statusCode).toBe(400);

    res = await t.api({ method: 'DELETE', url: '/api/rest-days/vacations/2026-10-01' });
    expect(res.statusCode).toBe(200);
    expect(res.json().policy.vacations).toEqual([]);
    expect(res.json().editsRemaining).toBe(0);

    // Pending pattern materializes on the next /me read once its Monday arrives.
    t.clock.now = '2026-09-21T10:00:00.000Z';
    await t.api({ method: 'GET', url: '/api/me' });
    res = await t.api({ method: 'GET', url: '/api/rest-days' });
    expect(res.json().policy.weeklyRestDays).toEqual([3]);
    expect(res.json().policy.pendingWeeklyRestDays).toBeNull();
  });

  it('deletes the account', async () => {
    const res = await t.api({ method: 'DELETE', url: '/api/me', token: t.tokenB });
    expect(res.statusCode).toBe(204);
  });
});

describe('quote', () => {
  it('holds a pick for six hours, then moves on, and honours the off mode', async () => {
    const a = await t.api({ method: 'GET', url: '/api/quote' });
    expect(a.statusCode).toBe(200);
    expect(a.json().pick.kind).toBe('quote');
    const nextAt = Date.parse(a.json().nextAt);
    expect(nextAt).toBeGreaterThan(Date.parse(t.clock.now));
    expect(nextAt - Date.parse(t.clock.now)).toBeLessThanOrEqual(6 * 3_600_000);
    const b = await t.api({ method: 'GET', url: '/api/quote' });
    expect(b.json().pick.item.id).toBe(a.json().pick.item.id);

    t.clock.now = new Date(nextAt).toISOString();
    const next = await t.api({ method: 'GET', url: '/api/quote' });
    expect(next.json().pick.item.id).not.toBe(a.json().pick.item.id);
    expect(Date.parse(next.json().nextAt) - nextAt).toBe(6 * 3_600_000);

    await t.api({ method: 'PATCH', url: '/api/me/settings', payload: { quote: { mode: 'off' } } });
    const c = await t.api({ method: 'GET', url: '/api/quote' });
    expect(c.json().pick).toBeNull();
  });
});

describe('custom background upload', () => {
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  it('stores, serves, and removes an uploaded image and flips the theme setting', async () => {
    expect((await t.api({ method: 'GET', url: '/api/me/background' })).statusCode).toBe(404);
    let res = await t.api({
      method: 'PUT',
      url: '/api/me/background',
      payload: { dataUrl: `data:image/png;base64,${png}` },
    });
    expect(res.statusCode).toBe(200);
    res = await t.api({ method: 'GET', url: '/api/me/background' });
    expect(res.json().dataUrl).toBe(`data:image/png;base64,${png}`);
    expect(
      (await t.api({ method: 'GET', url: '/api/me' })).json().user.settings.theme
        .customBackgroundUrl,
    ).toBe('upload');
    expect(
      (
        await t.api({
          method: 'PUT',
          url: '/api/me/background',
          payload: { dataUrl: 'data:text/plain;base64,aGk=' },
        })
      ).statusCode,
    ).toBe(400);
    expect((await t.api({ method: 'DELETE', url: '/api/me/background' })).statusCode).toBe(204);
    expect((await t.api({ method: 'GET', url: '/api/me/background' })).statusCode).toBe(404);
    expect(
      (await t.api({ method: 'GET', url: '/api/me' })).json().user.settings.theme
        .customBackgroundUrl,
    ).toBeNull();
  });

  it('stores a list setting as a list rather than merging it into an object', async () => {
    // Spreading an array into an object would persist {"0": "xp"}, which reads back as a
    // dismissal of nothing.
    const first = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { dismissed: ['xp'] },
    });
    expect(first.json().settings.dismissed).toEqual(['xp']);

    // A later patch replaces the list outright rather than leaving stale indices behind.
    const second = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { dismissed: ['xp', 'calendar'] },
    });
    expect(second.json().settings.dismissed).toEqual(['xp', 'calendar']);

    const me = await t.api({ method: 'GET', url: '/api/me' });
    expect(me.json().user.settings.dismissed).toEqual(['xp', 'calendar']);
  });

  it('keeps a name and a grading scale', async () => {
    const res = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { profile: { name: 'Zach' } },
    });
    expect(res.json().settings.profile.name).toBe('Zach');
    // The default scale is U of T, and it survives a patch of an unrelated group.
    expect(res.json().settings.grading.scale[0]).toMatchObject({ letter: 'A+', points: 4 });
  });

  it('accepts panel style settings', async () => {
    const res = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { theme: { panel: 'custom', panelColor: '#336699', panelAlpha: 0.8 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings.theme.panel).toBe('custom');
    expect(
      (
        await t.api({
          method: 'PATCH',
          url: '/api/me/settings',
          payload: { theme: { panelColor: 'blue' } },
        })
      ).statusCode,
    ).toBe(400);
  });
});
