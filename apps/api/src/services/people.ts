import { personName, universityById } from '@komogon/core';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { userAssets, users, type UserRow } from '../db/schema';
import { settingsOf } from './users';

/** What anyone signed in may see of a person: the names, picture and university. */
export interface Person {
  id: string;
  /** The chosen name, else the @username, else "Someone" (`personName`); never an email. */
  name: string;
  /** Without the @. */
  username: string | null;
  avatarUrl: string | null;
  university: { id: string; name: string; short?: string } | null;
}

export function personOf(row: UserRow, avatar?: { mime: string; data: string } | null): Person {
  const settings = settingsOf(row);
  const uni = universityById(settings.profile.university);
  return {
    id: row.id,
    name: personName(settings.profile.name, row.username),
    username: row.username,
    avatarUrl: avatar ? `data:${avatar.mime};base64,${avatar.data}` : null,
    university: uni ? { id: uni.id, name: uni.name, short: uni.short } : null,
  };
}

/**
 * The people behind a list of ids, keyed by id, each once: a feed names its authors in
 * one map rather than repeating a picture on every post.
 */
export async function loadPeople(db: Db, ids: Iterable<string>): Promise<Record<string, Person>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return {};
  const [rows, avatars] = await Promise.all([
    db.query.users.findMany({ where: inArray(users.id, unique) }),
    db.query.userAssets.findMany({
      where: and(inArray(userAssets.userId, unique), eq(userAssets.kind, 'avatar')),
      columns: { userId: true, mime: true, data: true },
    }),
  ]);
  const pictures = new Map(avatars.map((a) => [a.userId, a]));
  const out: Record<string, Person> = {};
  for (const row of rows) out[row.id] = personOf(row, pictures.get(row.id));
  return out;
}
