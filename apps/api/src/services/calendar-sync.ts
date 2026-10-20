import { and, eq, gte, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  googleCalendar,
  nodes,
  plannedBlocks,
  type PlannedBlockRow,
  type UserRow,
} from '../db/schema';
import { decrypt, encrypt } from './crypto';
import {
  GoogleRevokedError,
  GoogleSyncTokenExpiredError,
  type EventInput,
  type GoogleCalendarClient,
  type GoogleEvent,
} from './google';
import { dt } from './sessions-mapper';

export interface CalendarDeps {
  google: GoogleCalendarClient;
  encryptionKey: string;
}

export type ConnectionStatus =
  | { connected: false }
  | {
      connected: true;
      revoked: boolean;
      studyCalendarId: string | null;
      lastSyncAt: string | null;
      connectedAt: string;
    };

export async function connectionStatus(db: Db, userId: string): Promise<ConnectionStatus> {
  const row = await db.query.googleCalendar.findFirst({ where: eq(googleCalendar.userId, userId) });
  if (!row) return { connected: false };
  return {
    connected: true,
    revoked: row.revokedAt !== null,
    studyCalendarId: row.studyCalendarId,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    connectedAt: row.connectedAt.toISOString(),
  };
}

/** Store the refresh token after the consent callback and create the "Study" calendar. */
export async function completeConnection(
  db: Db,
  deps: CalendarDeps,
  user: UserRow,
  code: string,
  now: string,
): Promise<{ studyCalendarId: string }> {
  const tokens = await deps.google.exchangeCode(code);
  if (!tokens.refreshToken)
    throw new Error('Google did not return a refresh token; retry with consent.');
  const calendars = await deps.google.listCalendars(tokens.accessToken);
  const existing = calendars.find((c) => c.summary === 'Study');
  const studyCalendarId =
    existing?.id ?? (await deps.google.createCalendar(tokens.accessToken, 'Study')).id;
  await db
    .insert(googleCalendar)
    .values({
      userId: user.id,
      refreshTokenEnc: encrypt(tokens.refreshToken, deps.encryptionKey),
      studyCalendarId,
      syncToken: null,
      revokedAt: null,
      connectedAt: dt(now),
    })
    .onConflictDoUpdate({
      target: googleCalendar.userId,
      set: {
        refreshTokenEnc: encrypt(tokens.refreshToken, deps.encryptionKey),
        studyCalendarId,
        syncToken: null,
        revokedAt: null,
        connectedAt: dt(now),
      },
    });
  return { studyCalendarId };
}

export async function disconnect(db: Db, userId: string): Promise<void> {
  await db.delete(googleCalendar).where(eq(googleCalendar.userId, userId));
  // Keep imported blocks, but they are no longer linked to Google.
  await db
    .update(plannedBlocks)
    .set({ googleEventId: null })
    .where(and(eq(plannedBlocks.userId, userId), isNotNull(plannedBlocks.googleEventId)));
}

async function accessTokenFor(
  db: Db,
  deps: CalendarDeps,
  userId: string,
): Promise<{ token: string; calendarId: string; syncToken: string | null } | null> {
  const row = await db.query.googleCalendar.findFirst({ where: eq(googleCalendar.userId, userId) });
  if (!row || row.revokedAt || !row.studyCalendarId) return null;
  try {
    const t = await deps.google.refreshAccessToken(
      decrypt(row.refreshTokenEnc, deps.encryptionKey),
    );
    return { token: t.accessToken, calendarId: row.studyCalendarId, syncToken: row.syncToken };
  } catch (err) {
    if (err instanceof GoogleRevokedError) {
      await db
        .update(googleCalendar)
        .set({ revokedAt: new Date() })
        .where(eq(googleCalendar.userId, userId));
      return null;
    }
    throw err;
  }
}

async function eventFor(db: Db, block: PlannedBlockRow): Promise<EventInput> {
  const node = block.nodeId
    ? await db.query.nodes.findFirst({ where: eq(nodes.id, block.nodeId) })
    : null;
  const done = block.source === 'session';
  return {
    summary: node ? `Study: ${node.title}` : (block.title ?? 'Study'),
    description: done ? 'Studied in Komodon' : 'Planned in Komodon',
    start: block.startAt.toISOString(),
    end: block.endAt.toISOString(),
    komogonBlockId: block.id,
  };
}

/** Blocks Komodon owns and therefore writes out to the Study calendar. */
function isOurs(block: Pick<PlannedBlockRow, 'source'>): boolean {
  return block.source === 'app' || block.source === 'session';
}

/* ---------- Immediate propagation of app edits (best effort; sync reconciles the rest) ---------- */

export async function pushBlockCreated(
  db: Db,
  deps: CalendarDeps | null,
  block: PlannedBlockRow,
): Promise<void> {
  if (!deps || !isOurs(block)) return;
  const auth = await accessTokenFor(db, deps, block.userId);
  if (!auth) return;
  try {
    const { id } = await deps.google.insertEvent(
      auth.token,
      auth.calendarId,
      await eventFor(db, block),
    );
    await db.update(plannedBlocks).set({ googleEventId: id }).where(eq(plannedBlocks.id, block.id));
  } catch {
    /* next sync will push it */
  }
}

export async function pushBlockUpdated(
  db: Db,
  deps: CalendarDeps | null,
  block: PlannedBlockRow,
): Promise<void> {
  if (!deps) return;
  const auth = await accessTokenFor(db, deps, block.userId);
  if (!auth) return;
  try {
    if (block.cancelled && block.googleEventId) {
      await deps.google.deleteEvent(auth.token, auth.calendarId, block.googleEventId);
    } else if (block.googleEventId) {
      await deps.google.updateEvent(
        auth.token,
        auth.calendarId,
        block.googleEventId,
        await eventFor(db, block),
      );
    } else if (isOurs(block) && !block.cancelled) {
      const { id } = await deps.google.insertEvent(
        auth.token,
        auth.calendarId,
        await eventFor(db, block),
      );
      await db
        .update(plannedBlocks)
        .set({ googleEventId: id })
        .where(eq(plannedBlocks.id, block.id));
    }
  } catch {
    /* next sync will reconcile */
  }
}

export async function pushBlockDeleted(
  db: Db,
  deps: CalendarDeps | null,
  block: PlannedBlockRow,
): Promise<void> {
  if (!deps || !block.googleEventId) return;
  const auth = await accessTokenFor(db, deps, block.userId);
  if (!auth) return;
  try {
    await deps.google.deleteEvent(auth.token, auth.calendarId, block.googleEventId);
  } catch {
    /* already gone or transient */
  }
}

/* ---------- Full sync: push app blocks, pull Google changes ---------- */

export interface SyncResult {
  status: 'ok' | 'not-connected' | 'revoked';
  pushed: number;
  pulled: number;
  imported: number;
}

export async function syncGoogle(
  db: Db,
  deps: CalendarDeps,
  user: UserRow,
  now: string,
): Promise<SyncResult> {
  const status = await connectionStatus(db, user.id);
  if (!status.connected) return { status: 'not-connected', pushed: 0, pulled: 0, imported: 0 };
  const auth = await accessTokenFor(db, deps, user.id);
  if (!auth) return { status: 'revoked', pushed: 0, pulled: 0, imported: 0 };

  let pushed = 0;
  let pulled = 0;
  let imported = 0;

  // Push: app-created blocks without an event, and cancelled ones that still have one.
  const blocks = await db.query.plannedBlocks.findMany({
    where: eq(plannedBlocks.userId, user.id),
  });
  for (const b of blocks) {
    // Imported commitments are the user's other calendar showing through; Komodon never
    // writes them back out.
    if (!isOurs(b)) continue;
    if (!b.googleEventId && !b.cancelled) {
      const { id } = await deps.google.insertEvent(
        auth.token,
        auth.calendarId,
        await eventFor(db, b),
      );
      await db.update(plannedBlocks).set({ googleEventId: id }).where(eq(plannedBlocks.id, b.id));
      pushed++;
    } else if (b.googleEventId && b.cancelled) {
      await deps.google.deleteEvent(auth.token, auth.calendarId, b.googleEventId);
      await db.update(plannedBlocks).set({ googleEventId: null }).where(eq(plannedBlocks.id, b.id));
      pushed++;
    }
  }

  // Pull: incremental with the sync token; full window on first sync or expiry.
  let result;
  try {
    result = await deps.google.listEvents(auth.token, auth.calendarId, {
      syncToken: auth.syncToken,
      timeMin: new Date(Date.parse(now) - 30 * 86_400_000).toISOString(),
    });
  } catch (err) {
    if (!(err instanceof GoogleSyncTokenExpiredError)) throw err;
    result = await deps.google.listEvents(auth.token, auth.calendarId, {
      syncToken: null,
      timeMin: new Date(Date.parse(now) - 30 * 86_400_000).toISOString(),
    });
  }

  const byEventId = new Map<string, PlannedBlockRow>();
  for (const b of await db.query.plannedBlocks.findMany({
    where: and(eq(plannedBlocks.userId, user.id), isNotNull(plannedBlocks.googleEventId)),
  })) {
    byEventId.set(b.googleEventId!, b);
  }

  for (const ev of result.items) {
    const change = await applyEvent(db, user.id, ev, byEventId);
    if (change === 'updated') pulled++;
    if (change === 'imported') imported++;
  }

  await db
    .update(googleCalendar)
    .set({ syncToken: result.nextSyncToken, lastSyncAt: dt(now) })
    .where(eq(googleCalendar.userId, user.id));

  return { status: 'ok', pushed, pulled, imported };
}

type Change = 'updated' | 'imported' | 'none';

async function applyEvent(
  db: Db,
  userId: string,
  ev: GoogleEvent,
  byEventId: Map<string, PlannedBlockRow>,
): Promise<Change> {
  const existing = byEventId.get(ev.id);
  const cancelled = ev.status === 'cancelled';
  const start = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00.000Z` : null);
  const end = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T00:00:00.000Z` : null);

  if (existing) {
    if (cancelled) {
      if (!existing.cancelled) {
        await db
          .update(plannedBlocks)
          .set({ cancelled: true, updatedAt: new Date() })
          .where(eq(plannedBlocks.id, existing.id));
        return 'updated';
      }
      return 'none';
    }
    if (
      start &&
      end &&
      (existing.startAt.toISOString() !== new Date(start).toISOString() ||
        existing.endAt.toISOString() !== new Date(end).toISOString())
    ) {
      await db
        .update(plannedBlocks)
        .set({ startAt: dt(start), endAt: dt(end), updatedAt: new Date() })
        .where(eq(plannedBlocks.id, existing.id));
      return 'updated';
    }
    return 'none';
  }

  if (cancelled || !start || !end) return 'none';
  // An event that appeared in the calendar from outside Komodon. It is imported as a
  // commitment - something the user has to work around - not as study time. Nothing here
  // schedules work or nags the user to study: only routines do that.
  await db
    .insert(plannedBlocks)
    .values({
      userId,
      nodeId: null,
      startAt: dt(start),
      endAt: dt(end),
      source: 'google',
      title: ev.summary ?? null,
      googleEventId: ev.id,
    })
    .onConflictDoNothing();
  return 'imported';
}

/** Busy intervals from the user's primary calendar. Empty when not connected. */
export async function busyTimes(
  db: Db,
  deps: CalendarDeps | null,
  userId: string,
  from: string,
  to: string,
): Promise<Array<{ start: string; end: string }>> {
  if (!deps) return [];
  const auth = await accessTokenFor(db, deps, userId);
  if (!auth) return [];
  try {
    return await deps.google.freeBusy(auth.token, 'primary', from, to);
  } catch {
    return [];
  }
}

/**
 * Commitments imported from the connected calendar, from `from` onwards.
 *
 * These are deliberately *not* offered up to be linked to a task. An event in the user's
 * calendar is a thing they have to be somewhere for, not a declaration that they intend to
 * study then - assuming otherwise is how a study app ends up telling someone to revise
 * during their own wedding.
 */
export async function importedCommitments(
  db: Db,
  userId: string,
  from: string,
): Promise<PlannedBlockRow[]> {
  return db.query.plannedBlocks.findMany({
    where: and(
      eq(plannedBlocks.userId, userId),
      eq(plannedBlocks.source, 'google'),
      eq(plannedBlocks.cancelled, false),
      gte(plannedBlocks.endAt, dt(from)),
    ),
  });
}
