import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { advanceClock, createTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp('2026-09-26T16:00:00.000Z'); // Saturday noon Toronto
});
afterEach(() => t.close());

const start = async (payload: Record<string, unknown>) =>
  (await t.api({ method: 'POST', url: '/api/sessions', payload })).json().active.session
    .id as string;
const end = (id: string, payload: Record<string, unknown> = {}) =>
  t.api({ method: 'POST', url: `/api/sessions/${id}/end`, payload });
const me = async () => (await t.api({ method: 'GET', url: '/api/me' })).json().user;

describe('deleting time from a session', () => {
  it('moves the end back, scales the XP down, and takes back badges that no longer hold', async () => {
    const node = (
      await t.api({ method: 'POST', url: '/api/nodes', payload: { title: 'Essay' } })
    ).json().node.id;
    const id = await start({ nodeId: node, mode: 'unlimited' });
    advanceClock(t, 5 * 60 + 30); // 5 h 30 m, straight through
    const summary = (await end(id, { review: { skipped: true } })).json().summary;
    expect(summary.badges).toEqual(expect.arrayContaining(['deep-work', 'marathon']));
    const before = await me();
    expect(before.xp).toBe(summary.xpTotal);

    const res = await t.api({
      method: 'POST',
      url: `/api/sessions/${id}/trim`,
      payload: { removeFocusMinutes: 240 },
    });
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.session.workSeconds).toBe(90 * 60);
    expect(r.session.endedAt).toBe('2026-09-26T17:30:00.000Z');
    expect(r.removedFocusSeconds).toBe(240 * 60);
    expect(r.session.xpAwarded).toBe(Math.floor((summary.xp.total * 90) / 330));
    expect(r.xpRemoved).toBe(summary.xp.total - r.session.xpAwarded);
    expect(r.xpTotal).toBe(before.xp - r.xpRemoved);
    // 1 h 30 m is neither a two-hour session nor a four-hour day any more.
    expect(r.badgesRevoked).toEqual(expect.arrayContaining(['deep-work', 'marathon']));
    expect(r.badgesRevoked).not.toContain('first-session');
    expect(r.session.badgesAwarded).toContain('first-session');
    expect(r.session.title).toBe('Essay');

    const after = await me();
    expect(after.xp).toBe(r.xpTotal);
    const shop = (await t.api({ method: 'GET', url: '/api/shop' })).json();
    const keys = shop.achievements.map((a: { key: string }) => a.key);
    expect(keys).not.toContain('deep-work');
    expect(keys).toContain('first-session');

    // The calendar's record of the session is shortened with it.
    const blocks = (await t.api({ method: 'GET', url: '/api/planned-blocks' })).json().blocks;
    expect(blocks.find((b: { sessionId: string }) => b.sessionId === id).endAt).toBe(
      '2026-09-26T17:30:00.000Z',
    );
  });

  it('refuses a running session, nothing left to delete, and a stranger', async () => {
    const id = await start({ mode: 'unlimited' });
    advanceClock(t, 30);
    expect(
      (
        await t.api({
          method: 'POST',
          url: `/api/sessions/${id}/trim`,
          payload: { removeFocusMinutes: 5 },
        })
      ).statusCode,
    ).toBe(409);
    await end(id);
    const once = await t.api({
      method: 'POST',
      url: `/api/sessions/${id}/trim`,
      payload: { removeFocusMinutes: 600 },
    });
    // Capped: a minute is always left.
    expect(once.json().session.workSeconds).toBe(60);
    const again = await t.api({
      method: 'POST',
      url: `/api/sessions/${id}/trim`,
      payload: { removeFocusMinutes: 1 },
    });
    expect(again.statusCode).toBe(400);
    const other = await t.api({
      method: 'POST',
      url: `/api/sessions/${id}/trim`,
      payload: { removeFocusMinutes: 1 },
      token: t.tokenB,
    });
    expect(other.statusCode).toBe(404);
  });
});

describe('sleep while a session runs', () => {
  it('logs a sleep without pausing, and "kept studying" leaves the time alone', async () => {
    const id = await start({ mode: 'unlimited' });
    advanceClock(t, 20);
    const from = t.clock.now;
    advanceClock(t, 60);
    const res = await t.api({
      method: 'POST',
      url: `/api/sessions/${id}/sleep`,
      payload: { from, to: t.clock.now },
    });
    const active = res.json().active;
    expect(active.timer.phase).toBe('work');
    expect(active.session.sleeps).toEqual([{ from, to: t.clock.now, answer: null }]);
    // A second tab waking to the same sleep does not log it twice.
    const twice = await t.api({
      method: 'POST',
      url: `/api/sessions/${id}/sleep`,
      payload: { from, to: t.clock.now },
    });
    expect(twice.json().active.session.sleeps).toHaveLength(1);
    // Under ten minutes is not a sleep.
    const short = await t.api({
      method: 'POST',
      url: `/api/sessions/${id}/sleep`,
      payload: {
        from: t.clock.now,
        to: new Date(Date.parse(t.clock.now) + 5 * 60_000).toISOString(),
      },
    });
    expect(short.json().active.session.sleeps).toHaveLength(1);

    const kept = await t.api({
      method: 'POST',
      url: `/api/sessions/${id}/sleep/kept`,
      payload: { from },
    });
    expect(kept.json().active.session.sleeps[0].answer).toBe('kept');
    const summary = (await end(id)).json().summary;
    expect(summary.session.workSeconds).toBe(80 * 60);
  });

  it('"I stopped" ends the session back when the computer fell asleep', async () => {
    const id = await start({ mode: 'unlimited' });
    advanceClock(t, 45);
    const from = t.clock.now;
    advanceClock(t, 120);
    await t.api({
      method: 'POST',
      url: `/api/sessions/${id}/sleep`,
      payload: { from, to: t.clock.now },
    });
    const res = await end(id, { endAt: from });
    expect(res.statusCode).toBe(200);
    const { summary } = res.json();
    expect(summary.session.endedAt).toBe(from);
    expect(summary.session.workSeconds).toBe(45 * 60);
    expect(summary.session.sleeps[0].answer).toBe('stopped');
    // The XP is for the 45 minutes, not the 165.
    expect(summary.xp.base).toBe(90);
  });

  it('will not end a session in the future or before it began', async () => {
    const id = await start({ mode: 'unlimited' });
    advanceClock(t, 30);
    const future = new Date(Date.parse(t.clock.now) + 60_000).toISOString();
    expect((await end(id, { endAt: future })).statusCode).toBe(400);
    expect((await end(id, { endAt: '2026-09-26T15:00:00.000Z' })).statusCode).toBe(400);
  });
});

describe('session history', () => {
  it('lists finished sessions newest first with their titles, a page at a time', async () => {
    const node = (
      await t.api({ method: 'POST', url: '/api/nodes', payload: { title: 'Reading' } })
    ).json().node.id;
    for (const payload of [{ nodeId: node, mode: 'unlimited' }, { mode: 'unlimited' }]) {
      const id = await start(payload);
      advanceClock(t, 25);
      await end(id);
      advanceClock(t, 5);
    }
    const running = await start({ mode: 'unlimited' });
    expect(running).toBeTruthy();
    const all = (await t.api({ method: 'GET', url: '/api/sessions/history' })).json().sessions;
    expect(all.map((s: { title: string }) => s.title)).toEqual(['Free session', 'Reading']);
    const page = (
      await t.api({
        method: 'GET',
        url: `/api/sessions/history?limit=1&before=${encodeURIComponent(all[0].startedAt)}`,
      })
    ).json().sessions;
    expect(page.map((s: { title: string }) => s.title)).toEqual(['Reading']);
  });
});
