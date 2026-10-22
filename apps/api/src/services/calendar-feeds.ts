import { createHash } from 'node:crypto';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import zlib from 'node:zlib';
import { looksLikeIcs, readIcsFeed } from '@komogon/core';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { calendarFeeds, calendarImports, plannedBlocks, type UserRow } from '../db/schema';
import { importCalendarSnapshot, withImportLock, type ImportResult } from './calendar-import';
import type { AcademicEvent } from './calendar-recognition';
import { decrypt, encrypt } from './crypto';

/** How many calendars one account can add by link. */
export const FEEDS_PER_USER = 10;
export const FEED_MAX_BYTES = 5_000_000;
const FEED_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 4;
/** A calendar is read again when it was last read longer ago than this. */
export const FEED_REFRESH_MS = 15 * 60_000;

/** A problem with a calendar link, in words fit for the settings page. */
export class FeedError extends Error {}

/** Fetches a calendar link and answers its text. Swapped for a fake in tests. */
export type FeedFetcher = (url: string) => Promise<string>;

export interface FeedDeps {
  fetch: FeedFetcher;
  /** 32-byte hex key the links are encrypted with. */
  key: string;
}

export type FeedRow = typeof calendarFeeds.$inferSelect;

export interface FeedView {
  id: string;
  name: string;
  host: string;
  tasks: boolean;
  events: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

export function feedView(row: FeedRow): FeedView {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    tasks: row.tasks,
    events: row.events,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    lastError: row.lastError,
  };
}

/** The links' encryption key, derived from a server secret so no new setting is needed. */
export function feedKey(secret: string): string {
  return createHash('sha256').update(`calendar-feeds\0${secret}`).digest('hex');
}

export function feedUrlHash(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

// Addresses a link must never reach: this machine, the private network, link-local
// (cloud metadata lives there), carrier NAT, multicast and the reserved ranges.
// Two lists: one BlockList would match every IPv4 address against the IPv4-mapped range.
const blocked4 = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const)
  blocked4.addSubnet(net, bits, 'ipv4');
const blocked6 = new BlockList();
for (const [net, bits] of [
  ['::', 127],
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blocked6.addSubnet(net, bits, 'ipv6');

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked4.check(address, 'ipv4');
  if (family !== 6) return true;
  // ::ffff:127.0.0.1 is 127.0.0.1 in disguise.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return blocked4.check(mapped[1]!, 'ipv4');
  if (/^::ffff:/i.test(address)) return true;
  return blocked6.check(address, 'ipv6');
}

/** A pasted link as a URL we are willing to fetch: webcal becomes https, ports stay normal. */
export function normalizeFeedUrl(raw: string): URL {
  const text = raw.trim().replace(/^webcals?:\/\//i, 'https://');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new FeedError('That doesn’t look like a link. Paste the calendar’s full address.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new FeedError('Use the calendar’s web address (https:// or webcal://).');
  if (url.username || url.password)
    throw new FeedError('Links with a password in them can’t be added.');
  if (url.port && url.port !== '443' && url.port !== '80')
    throw new FeedError('That link uses an unusual port, so it can’t be added.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal'))
    throw new FeedError('That link points at a private address.');
  if (isIP(host) && isBlockedAddress(host))
    throw new FeedError('That link points at a private address.');
  url.hash = '';
  return url;
}

/** DNS lookup that refuses private addresses at connect time, so a rebinding trick can't slip past. */
function safeLookup(
  hostname: string,
  options: { all?: boolean; family?: number | 'IPv4' | 'IPv6' },
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
) {
  dnsLookup(hostname, { family: options.family, all: true }, (err, list) => {
    if (err) return callback(err, options.all ? [] : '', 0);
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address)))
      return callback(
        new FeedError('That link points at a private address.'),
        options.all ? [] : '',
        0,
      );
    if (options.all) return callback(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
}

function getOnce(url: URL): Promise<{ status: number; location: string | null; body: string }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(
      url,
      {
        lookup: safeLookup as never,
        headers: {
          'user-agent': 'Komodon calendar (+https://komogon.app)',
          accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5',
          'accept-encoding': 'gzip, deflate, br',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ status, location: res.headers.location ?? null, body: '' });
          return;
        }
        if (Number(res.headers['content-length'] ?? 0) > FEED_MAX_BYTES) {
          res.destroy();
          reject(new FeedError('That calendar is too big to add (over 5 MB).'));
          return;
        }
        const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
        const stream =
          encoding === 'gzip'
            ? res.pipe(zlib.createGunzip())
            : encoding === 'deflate'
              ? res.pipe(zlib.createInflate())
              : encoding === 'br'
                ? res.pipe(zlib.createBrotliDecompress())
                : res;
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > FEED_MAX_BYTES) {
            req.destroy(new FeedError('That calendar is too big to add (over 5 MB).'));
            return;
          }
          chunks.push(chunk);
        });
        stream.on('end', () =>
          resolve({ status, location: null, body: Buffer.concat(chunks).toString('utf8') }),
        );
        stream.on('error', reject);
      },
    );
    req.setTimeout(FEED_TIMEOUT_MS, () =>
      req.destroy(new FeedError('That calendar took too long to answer. Try again later.')),
    );
    req.on('error', reject);
  });
}

/** The real fetcher: follows a few redirects, checking every hop like the first. */
export const fetchFeedText: FeedFetcher = async (raw) => {
  let url = normalizeFeedUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Awaited<ReturnType<typeof getOnce>>;
    try {
      res = await getOnce(url);
    } catch (err) {
      if (err instanceof FeedError) throw err;
      throw new FeedError('Couldn’t reach that calendar. Check the link and try again.');
    }
    if (res.location) {
      url = normalizeFeedUrl(new URL(res.location, url).toString());
      continue;
    }
    if (res.status === 401 || res.status === 403)
      throw new FeedError('That calendar is private. Use its secret or public address instead.');
    if (res.status === 404 || res.status === 410)
      throw new FeedError('There’s no calendar at that link any more.');
    if (res.status < 200 || res.status >= 300)
      throw new FeedError(`That calendar couldn’t be read (the server answered ${res.status}).`);
    return res.body;
  }
  throw new FeedError('That link redirects too many times.');
};

export const NOT_A_CALENDAR =
  'That link doesn’t lead to a calendar. Copy the address that ends in .ics.';

/** The window imported, matching connected calendars: a month back, six months ahead. */
export function feedWindow(now: string) {
  return {
    from: new Date(Date.parse(now) - 30 * 86_400_000).toISOString(),
    to: new Date(Date.parse(now) + 180 * 86_400_000).toISOString(),
  };
}

export interface FeedSyncResult {
  feed: FeedRow;
  result: ImportResult | null;
}

/**
 * Read one added calendar and bring its events up to date. A failure is saved on the feed
 * (and its events stay as they were) rather than thrown, so the page can say what went wrong.
 * `text` skips the fetch when the caller has just fetched the link.
 */
export async function syncFeed(
  db: Db,
  user: Pick<UserRow, 'id' | 'timezone'>,
  feed: FeedRow,
  deps: FeedDeps,
  now: string,
  text?: string,
): Promise<FeedSyncResult> {
  const fail = async (message: string) => {
    const [row] = await db
      .update(calendarFeeds)
      .set({ lastError: message, checkedAt: new Date(now) })
      .where(eq(calendarFeeds.id, feed.id))
      .returning();
    return { feed: row ?? feed, result: null };
  };
  let body = text;
  if (body === undefined) {
    let url: string;
    try {
      url = decrypt(feed.urlEnc, deps.key);
    } catch {
      return fail('This calendar needs adding again.');
    }
    try {
      body = await deps.fetch(url);
    } catch (err) {
      return fail(
        err instanceof FeedError ? err.message : 'Couldn’t reach that calendar. Try again later.',
      );
    }
  }
  if (!looksLikeIcs(body)) return fail(NOT_A_CALENDAR);
  const { from, to } = feedWindow(now);
  const calendar = readIcsFeed(body, { from, to, timezone: user.timezone });
  const events: AcademicEvent[] = calendar.events.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description ?? undefined,
    calendarId: feed.id,
    calendarName: feed.name,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    free: e.free,
  }));
  const result = await withImportLock(user.id, () =>
    importCalendarSnapshot(db, user, 'ics', events, from, to, now, {
      calendarId: feed.id,
      tasks: feed.tasks,
    }),
  );
  const [row] = await db
    .update(calendarFeeds)
    .set({
      lastError: null,
      lastSyncAt: new Date(now),
      checkedAt: new Date(now),
      events: events.length,
    })
    .where(eq(calendarFeeds.id, feed.id))
    .returning();
  return { feed: row ?? feed, result };
}

/** Remove a calendar and its events from the planner. Tasks made from it are kept. */
export async function removeFeed(db: Db, userId: string, feedId: string): Promise<void> {
  await withImportLock(userId, () =>
    db.transaction(async (tx) => {
      const rows = await tx.query.calendarImports.findMany({
        where: and(
          eq(calendarImports.userId, userId),
          eq(calendarImports.provider, 'ics'),
          eq(calendarImports.calendarId, feedId),
          isNotNull(calendarImports.blockId),
        ),
        columns: { blockId: true },
      });
      const blockIds = rows.map((r) => r.blockId!);
      if (blockIds.length)
        await tx
          .delete(plannedBlocks)
          .where(and(eq(plannedBlocks.userId, userId), inArray(plannedBlocks.id, blockIds)));
      await tx
        .delete(calendarImports)
        .where(
          and(
            eq(calendarImports.userId, userId),
            eq(calendarImports.provider, 'ics'),
            eq(calendarImports.calendarId, feedId),
          ),
        );
      await tx
        .delete(calendarFeeds)
        .where(and(eq(calendarFeeds.id, feedId), eq(calendarFeeds.userId, userId)));
    }),
  );
}

export function encryptFeedUrl(url: string, key: string): string {
  return encrypt(url, key);
}
