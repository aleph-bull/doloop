import { levelForXp } from '@komogon/core';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { users } from '../db/schema';
import { advanceClock, createTestApp, USER_A, type TestApp } from './helpers';

// Spending and levelling after it are in shop.test.ts; these are XP taken back.
let t: TestApp;
// Monday 21 September 2026, 10:00 in Toronto.
beforeEach(async () => {
  t = await createTestApp('2026-09-21T14:00:00.000Z');
  await t.api({ method: 'GET', url: '/api/me' });
});
afterEach(() => t.close());

/** A free session of `minutes`; returns its end-of-session summary. */
async function study(minutes = 40) {
  const { active } = (
    await t.api({ method: 'POST', url: '/api/sessions', payload: { mode: 'unlimited' } })
  ).json();
  advanceClock(t, minutes);
  const res = await t.api({
    method: 'POST',
    url: `/api/sessions/${active.session.id}/end`,
    payload: { review: null },
  });
  return res.json().summary;
}

const count = async (id: string, counted: boolean) =>
  (await t.api({ method: 'PUT', url: `/api/sessions/${id}/counted`, payload: { counted } })).json();

describe('lifetime XP taken back', () => {
  it('a session that stops counting comes off both, and counting it again puts it back', async () => {
    const summary = await study();
    expect(summary.xpTotal).toBeGreaterThan(0);
    expect(summary.xpEarned).toBe(summary.xpTotal);

    const off = await count(summary.session.id, false);
    expect(off).toMatchObject({ xpTotal: 0, xpEarned: 0, level: 0 });

    const on = await count(summary.session.id, true);
    expect(on.xpTotal).toBe(summary.xpTotal);
    expect(on.xpEarned).toBe(summary.xpEarned);
    expect(on.level).toBe(levelForXp(summary.xpEarned));
  });

  it('comes off lifetime XP in full even when the balance was already spent', async () => {
    const summary = await study();
    // As if it all went in the shop: the balance can't go below zero, lifetime XP still drops.
    await t.db.update(users).set({ xp: 0 }).where(eq(users.id, USER_A.id));
    const off = await count(summary.session.id, false);
    expect(off).toMatchObject({ xpTotal: 0, xpEarned: 0, level: 0 });
  });
});
