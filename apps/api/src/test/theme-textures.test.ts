import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '../db/schema';
import { createTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp('2026-10-29T14:00:00.000Z');
});
afterAll(() => t.close());

let next = 0;
/** A new account with only this theme saved; returns its id. */
async function account(theme: object): Promise<string> {
  const id = `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`;
  await t.db.insert(users).values({ id, email: `p${next}@example.com`, icsToken: `t${next}` });
  await t.db
    .update(users)
    .set({ settings: sql`jsonb_build_object('theme', ${JSON.stringify(theme)}::jsonb)` })
    .where(eq(users.id, id));
  return id;
}

const run = (name: string) =>
  t.db.execute(
    sql.raw(readFileSync(join(import.meta.dirname, `../../drizzle/${name}.sql`), 'utf8')),
  );

const texture = async (id: string) =>
  (await t.db.query.users.findFirst({ where: eq(users.id, id) }))!.settings.theme?.texture;

describe('migration 0045', () => {
  it('gives the dots to accounts on Salt Air with no texture, and only them', async () => {
    const plain = await account({ backgroundId: 'solid:#e2e6e9', texture: 'none' });
    const grid = await account({ backgroundId: 'solid:#e2e6e9', texture: 'grid' });
    const linen = await account({ backgroundId: 'solid:#e7e6e3', texture: 'none' });
    await run('0045_salt_air_dots');
    expect(await texture(plain)).toBe('dots');
    expect(await texture(grid)).toBe('grid');
    expect(await texture(linen)).toBe('none');
  });
});

describe('migration 0046', () => {
  it("gives the five themes' accounts with no texture the theme's own", async () => {
    const want: Record<string, string> = {
      'solid:#1d1e26': 'dots', // Deep Sea
      'solid:#1a1c23': 'dots', // Dusk Rose
      'solid:#e7e6e3': 'grid', // Linen
      'solid:#313338': 'grid', // Night Shift
      'solid:#191f1f': 'grid', // Tidepool
    };
    const ids = await Promise.all(
      Object.keys(want).map((backgroundId) => account({ backgroundId, texture: 'none' })),
    );
    const unset = await account({ backgroundId: 'solid:#313338' });
    const grain = await account({ backgroundId: 'solid:#1d1e26', texture: 'grain' });
    const inkwell = await account({ backgroundId: 'solid:#1c1c21', texture: 'none' });
    await run('0046_theme_textures');
    for (const [i, backgroundId] of Object.keys(want).entries())
      expect(await texture(ids[i]!), backgroundId).toBe(want[backgroundId]);
    expect(await texture(unset)).toBe('grid');
    expect(await texture(grain)).toBe('grain');
    expect(await texture(inkwell)).toBe('none');
  });
});
