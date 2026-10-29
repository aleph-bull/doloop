import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '../db/schema';
import { createTestApp, USER_A, USER_B, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp('2026-10-29T14:00:00.000Z');
  for (const token of [t.tokenA, t.tokenB]) await t.api({ method: 'GET', url: '/api/me', token });
});
afterAll(() => t.close());

const OTHER = '00000000-0000-4000-8000-000000000001';

describe('migration 0045', () => {
  it('gives the dots to accounts on Salt Air with no texture, and only them', async () => {
    await t.db.insert(users).values({ id: OTHER, email: 'other@example.com', icsToken: 'other' });
    const setTheme = (id: string, theme: object) =>
      t.db
        .update(users)
        .set({ settings: sql`jsonb_build_object('theme', ${JSON.stringify(theme)}::jsonb)` })
        .where(eq(users.id, id));
    await setTheme(USER_A.id, { backgroundId: 'solid:#e2e6e9', texture: 'none' });
    await setTheme(USER_B.id, { backgroundId: 'solid:#e2e6e9', texture: 'grid' });
    await setTheme(OTHER, { backgroundId: 'solid:#e7e6e3', texture: 'none' });
    const file = join(import.meta.dirname, '../../drizzle/0045_salt_air_dots.sql');
    await t.db.execute(sql.raw(readFileSync(file, 'utf8')));
    const texture = async (id: string) =>
      (await t.db.query.users.findFirst({ where: eq(users.id, id) }))!.settings.theme?.texture;
    expect(await texture(USER_A.id)).toBe('dots');
    expect(await texture(USER_B.id)).toBe('grid');
    expect(await texture(OTHER)).toBe('none');
  });
});
