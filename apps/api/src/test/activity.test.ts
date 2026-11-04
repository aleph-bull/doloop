import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createPgliteDb, type Db } from '../db/client';
import { userActiveDays, users } from '../db/schema';
import { activityTracker } from '../services/activity';
import { ensureUser } from '../services/users';

describe('activity for the admin page', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createPgliteDb());
  });
  afterAll(async () => {
    await close();
  });

  it('writes at most once a minute, and one row a day in their own time zone', async () => {
    let now = '2026-11-03T03:30:00.000Z'; // 10:30pm on the 2nd in Toronto
    const track = activityTracker(db, () => now);
    const user = await ensureUser(
      db,
      { id: '77777777-7777-4777-8777-777777777777', email: 'a@example.com' },
      'America/Toronto',
    );
    const read = async () => ({
      at: (await db.query.users.findFirst({ where: eq(users.id, user.id) }))!.lastActiveAt,
      days: (await db.select().from(userActiveDays).where(eq(userActiveDays.userId, user.id)))
        .map((d) => d.day)
        .sort(),
    });

    await track(user);
    expect(await read()).toEqual({ at: new Date(now), days: ['2026-11-02'] });

    now = '2026-11-03T03:30:40.000Z';
    await track(user);
    expect((await read()).at).toEqual(new Date('2026-11-03T03:30:00.000Z'));

    now = '2026-11-03T05:10:00.000Z'; // past midnight in Toronto
    await track(user);
    expect(await read()).toEqual({ at: new Date(now), days: ['2026-11-02', '2026-11-03'] });
  });
});
