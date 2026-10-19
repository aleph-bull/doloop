import { badgeXp } from '@komogon/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers';

let t: TestApp;
// 2026-09-21 is a Monday in America/Toronto.
beforeAll(async () => {
  t = await createTestApp('2026-09-21T14:00:00.000Z');
  await t.api({ method: 'GET', url: '/api/me' }); // create the user
});
afterAll(() => t.close());

const create = (payload: Record<string, unknown>) =>
  t.api({ method: 'POST', url: '/api/routines', payload });

const tick = (id: string, date: string) =>
  t.api({ method: 'POST', url: `/api/routines/${id}/tick`, payload: { date } });

describe('recurring tasks', () => {
  let daily = '';

  it('starts empty', async () => {
    const res = await t.api({ method: 'GET', url: '/api/routines' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ today: '2026-09-21', routines: [], occurrences: [] });
  });

  it('creates a daily routine and expands its occurrences', async () => {
    const res = await create({
      title: 'Read 10 pages',
      estimatedMinutes: 20,
      freq: 'daily',
      startDate: '2026-09-21',
    });
    expect(res.statusCode).toBe(201);
    daily = res.json().routine.id;

    const agenda = await t.api({
      method: 'GET',
      url: '/api/routines?from=2026-09-21&to=2026-09-24',
    });
    expect(agenda.json().occurrences.map((o: { date: string }) => o.date)).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
    ]);
    expect(agenda.json().due).toHaveLength(1); // only today is due yet
  });

  it('refuses a routine with a bad estimate or a backwards date range', async () => {
    expect(
      (
        await create({
          title: 'Bad',
          estimatedMinutes: 0,
          freq: 'daily',
          startDate: '2026-09-21',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await create({
          title: 'Bad',
          estimatedMinutes: 20,
          freq: 'daily',
          startDate: '2026-09-21',
          endDate: '2026-09-20',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('ticks an occurrence off and pays XP for the estimate', async () => {
    const before = (await t.api({ method: 'GET', url: '/api/me' })).json().user.xp;
    const res = await tick(daily, '2026-09-21');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ xpAwarded: 20, cappedByDailyLimit: false });
    const after = (await t.api({ method: 'GET', url: '/api/me' })).json().user.xp;
    // Plus the first-tick badge, if this tick unlocked it.
    const badgeTotal = res.json().badges.reduce((s: number, k: string) => s + badgeXp(k), 0);
    expect(after).toBe(before + 20 + badgeTotal);
    expect(res.json().xpTotal).toBe(after);
  });

  it('refuses to pay twice for the same day', async () => {
    const res = await tick(daily, '2026-09-21');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Already ticked/);
  });

  it('refuses to tick a future day', async () => {
    const res = await tick(daily, '2026-09-25');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/has not arrived/);
  });

  it('refuses a day the routine does not fall on', async () => {
    const weekly = (
      await create({
        title: 'Mondays only',
        estimatedMinutes: 30,
        freq: 'weekly',
        byWeekday: [1],
        startDate: '2026-09-21',
      })
    ).json().routine.id;
    const res = await tick(weekly, '2026-09-20');
    expect(res.statusCode).toBe(400);
  });

  it('unticks and takes the XP back', async () => {
    const before = (await t.api({ method: 'GET', url: '/api/me' })).json().user.xp;
    const res = await t.api({
      method: 'DELETE',
      url: `/api/routines/${daily}/tick/2026-09-21`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ xpRemoved: 20 });
    const after = (await t.api({ method: 'GET', url: '/api/me' })).json().user.xp;
    expect(after).toBe(before - 20);
    // Re-tick so the rest of the suite sees a completed day.
    await tick(daily, '2026-09-21');
  });

  it('caps routine XP for the day', async () => {
    // Four 60-minute routines are worth 240 XP uncapped; the daily cap is 120.
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await create({
        title: `Big routine ${i}`,
        estimatedMinutes: 60,
        freq: 'daily',
        startDate: '2026-09-22',
      });
      ids.push(r.json().routine.id);
    }
    t.clock.now = '2026-09-22T14:00:00.000Z';
    const awards: number[] = [];
    for (const id of ids) awards.push((await tick(id, '2026-09-22')).json().xpAwarded);
    expect(awards).toEqual([60, 60, 0, 0]);
    expect(awards.reduce((a, b) => a + b, 0)).toBe(120);

    const agenda = await t.api({ method: 'GET', url: '/api/routines' });
    expect(agenda.json()).toMatchObject({ xpToday: 120, xpRemainingToday: 0 });
    t.clock.now = '2026-09-21T14:00:00.000Z';
  });

  it('banks XP against the occurrence date, not today', async () => {
    // Catching up on an old day draws from that day's budget, which is untouched.
    const id = (
      await create({
        title: 'Backfill',
        estimatedMinutes: 25,
        freq: 'daily',
        startDate: '2026-09-19',
      })
    ).json().routine.id;
    expect((await tick(id, '2026-09-19')).json().xpAwarded).toBe(25);
  });

  it('edits and archives a routine', async () => {
    const id = (
      await create({
        title: 'Editable',
        estimatedMinutes: 15,
        freq: 'weekly',
        byWeekday: [1],
        startDate: '2026-09-21',
      })
    ).json().routine.id;

    let res = await t.api({
      method: 'PATCH',
      url: `/api/routines/${id}`,
      payload: { title: 'Renamed', estimatedMinutes: 45 },
    });
    expect(res.json().routine).toMatchObject({ title: 'Renamed', estimatedMinutes: 45 });

    // Switching to monthly clears the weekday selector rather than failing validation.
    res = await t.api({
      method: 'PATCH',
      url: `/api/routines/${id}`,
      payload: { freq: 'monthly', byMonthday: [1] },
    });
    expect(res.json().routine).toMatchObject({ freq: 'monthly', byWeekday: [], byMonthday: [1] });

    res = await t.api({ method: 'PATCH', url: `/api/routines/${id}`, payload: { archived: true } });
    expect(res.json().routine.archived).toBe(true);
    expect((await tick(id, '2026-09-21')).statusCode).toBe(400);
  });

  it("will not touch another user's routine", async () => {
    const res = await t.api({
      method: 'PATCH',
      url: `/api/routines/${daily}`,
      payload: { title: 'Stolen' },
      token: t.tokenB,
    });
    expect(res.statusCode).toBe(404);
  });

  it('unlocks the habit badge', async () => {
    const res = await t.api({ method: 'GET', url: '/api/achievements' });
    expect(res.json().achievements.map((a: { key: string }) => a.key)).toContain('routine-starter');
  });
});

describe('ICS import', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:seminar@example.com',
    'SUMMARY:Stats seminar',
    'DTSTART:20260921T130000Z',
    'DTEND:20260921T143000Z',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TH',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:dentist@example.com',
    'SUMMARY:Dentist',
    'DTSTART:20260922T140000Z',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  it('imports recurring events and reports what it skipped', async () => {
    const res = await t.api({
      method: 'POST',
      url: '/api/routines/import-ics',
      payload: { ics },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ created: 1, updated: 0 });
    expect(res.json().routines[0]).toMatchObject({
      title: 'Stats seminar',
      freq: 'weekly',
      byWeekday: [1, 4],
      estimatedMinutes: 90,
      source: 'ics',
    });
    expect(res.json().skipped).toEqual([{ summary: 'Dentist', reason: 'Does not repeat' }]);
  });

  it('re-importing the same calendar updates rather than duplicates', async () => {
    const changed = ics.replace('Stats seminar', 'Statistics seminar');
    const res = await t.api({
      method: 'POST',
      url: '/api/routines/import-ics',
      payload: { ics: changed },
    });
    expect(res.json()).toMatchObject({ created: 0, updated: 1 });
    const all = (await t.api({ method: 'GET', url: '/api/routines/list' })).json().routines;
    expect(all.filter((r: { source: string }) => r.source === 'ics')).toHaveLength(1);
    expect(all.find((r: { source: string }) => r.source === 'ics').title).toBe(
      'Statistics seminar',
    );
  });

  it('refuses a file with no events', async () => {
    const res = await t.api({
      method: 'POST',
      url: '/api/routines/import-ics',
      payload: { ics: 'not a calendar' },
    });
    expect(res.statusCode).toBe(400);
  });
});
