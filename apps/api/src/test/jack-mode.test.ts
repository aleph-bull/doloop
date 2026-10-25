import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { users } from '../db/schema';
import { advanceClock, createTestApp, USER_A, USER_B, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp('2026-10-22T14:00:00.000Z');
  for (const token of [t.tokenA, t.tokenB]) {
    await t.api({ method: 'GET', url: '/api/me', token });
    await t.api({ method: 'PATCH', url: '/api/me', token, payload: { onboarded: true } });
  }
});
afterAll(() => t.close());

describe('Jack mode', () => {
  it('is off unless turned on', async () => {
    const me = await t.api({ method: 'GET', url: '/api/me' });
    expect(me.json().user.settings.pomodoro.jackMode).toBe(false);
    const on = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { pomodoro: { jackMode: true } },
    });
    expect(on.statusCode).toBe(200);
    expect(on.json().settings.pomodoro.jackMode).toBe(true);
  });

  it('rolls after each work block and keeps the rolls on the session', async () => {
    const start = await t.api({
      method: 'POST',
      url: '/api/sessions',
      payload: { mode: 'pomodoro' },
    });
    expect(start.statusCode).toBe(201);
    const { active } = start.json();
    expect(active.timer.jack).toMatchObject({ rolls: 0, wonSeconds: 0, lostSeconds: 0 });
    expect(typeof active.timer.jack.seed).toBe('string');

    advanceClock(t, 26);
    const after = (await t.api({ method: 'GET', url: '/api/sessions/active' })).json().active;
    expect(after.timer.jack.rolls).toBe(1);
    expect(after.timer.jack.last).toMatchObject({ cycle: 1, baseMs: 5 * 60_000 });
    // The timer waits for the lever.
    expect(after.timer).toMatchObject({ phase: 'paused', jack: { waiting: true } });
    const id = active.session.id;
    const pull = await t.api({
      method: 'POST',
      url: `/api/sessions/${id}/events`,
      payload: { type: 'jack-pull' },
    });
    expect(pull.statusCode).toBe(200);
    expect(pull.json().active.timer.jack.waiting).toBe(false);
    expect(pull.json().active.timer.phase).not.toBe('paused');

    // A spin never gives a break longer than 15 minutes, so 49 more minutes hold 25 of focus.
    advanceClock(t, 49);
    const end = await t.api({ method: 'POST', url: `/api/sessions/${id}/end`, payload: {} });
    expect(end.statusCode).toBe(200);
    const badges: string[] = end.json().summary.badges;
    expect(badges).toContain('gamble-1');
    expect(badges).toContain('gambler');
  });

  it('shows the die and the break won and lost on the profile', async () => {
    const mine = (await t.api({ method: 'GET', url: '/api/profiles/me' })).json();
    expect(mine.profile.gambler).toBe(true);
    expect(mine.stats.jack.rolls).toBeGreaterThanOrEqual(2);
    expect(mine.stats.jack.wonSeconds + mine.stats.jack.lostSeconds).toBeGreaterThanOrEqual(0);
    const theirs = (
      await t.api({ method: 'GET', url: '/api/profiles/me', token: t.tokenB })
    ).json();
    expect(theirs.profile.gambler).toBe(false);
    expect(theirs.stats.jack).toBeNull();
  });

  it('leaves a session alone when Jack mode is off', async () => {
    const start = await t.api({
      method: 'POST',
      url: '/api/sessions',
      payload: { mode: 'pomodoro' },
      token: t.tokenB,
    });
    expect(start.json().active.timer.jack).toBeUndefined();
  });

  it('is turned on for Jack Chow by the migration', async () => {
    const setName = (id: string, name: string) =>
      t.db
        .update(users)
        .set({
          settings: sql`jsonb_build_object('profile', jsonb_build_object('name', ${name}::text))`,
        })
        .where(eq(users.id, id));
    await setName(USER_A.id, '  Jack   chow ');
    await setName(USER_B.id, 'Jackie Chow');
    const file = join(import.meta.dirname, '../../drizzle/0031_jack_mode.sql');
    await t.db.execute(sql.raw(readFileSync(file, 'utf8')));
    const jackMode = async (id: string) =>
      (await t.db.query.users.findFirst({ where: eq(users.id, id) }))!.settings.pomodoro?.jackMode;
    expect(await jackMode(USER_A.id)).toBe(true);
    expect(await jackMode(USER_B.id)).toBeUndefined();
  });
});
