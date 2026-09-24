import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { schema } from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * The migrations folder beside the code: one level up from the tsup bundle (`dist`, which
 * inlines this module), two levels up from this file under tsx (`src/db`).
 */
export const MIGRATIONS_FOLDER = ['../drizzle', '../../drizzle']
  .map((rel) => fileURLToPath(new URL(rel, import.meta.url)))
  .find((dir) => existsSync(`${dir}/meta/_journal.json`))!;

/** Production/dev database over a Postgres connection string (Supabase pooler URI). */
export function createDb(connectionString: string): { db: Db; close: () => Promise<void> } {
  const client = postgres(connectionString, { prepare: false, max: 10 });
  const db = drizzlePg(client, { schema });
  return { db, close: () => client.end() };
}

/**
 * In-process Postgres (PGlite) with migrations applied. Used by tests (in memory) and
 * credential-free dev (persisted to dataDir so restarts keep your data).
 */
export async function createPgliteDb(
  dataDir?: string,
): Promise<{ db: Db; close: () => Promise<void> }> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db: db as unknown as Db, close: () => client.close() };
}

export async function migratePg(connectionString: string): Promise<void> {
  const { migrate } = await import('drizzle-orm/postgres-js/migrator');
  const client = postgres(connectionString, { prepare: false, max: 1 });
  const db = drizzlePg(client, { schema });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}
