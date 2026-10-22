import { and, asc, eq, gt, gte, isNotNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { mediaUploads, postMedia } from '../db/schema';
import { HttpError } from '../errors';
import type { MediaLog, MediaStore } from './media-store';
import { TooManyTries } from './rate-limit';

/** What one account may upload to R2 in any 24 hours, so nobody can fill the bucket. */
export const UPLOAD_BYTES_PER_DAY = 250 * 1024 * 1024;
/** Uploads stop for everyone once the bucket holds this much (R2's free storage). */
export const BUCKET_MAX_BYTES = 10 * 1024 * 1024 * 1024;
/** How long a measurement of the bucket is trusted before it is listed again. */
export const MEASURE_EVERY_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Rows are kept a day for the cap, plus a day while the lifecycle rule gets round to `uploads/`. */
const KEEP_MS = 2 * DAY_MS;

export const BUCKET_FULL =
  'Videos and pictures are paused for now. You can still post without one.';

/** "40 minutes", "about 5 hours". */
function roughly(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hour${hours === 1 ? '' : 's'}`;
}

const total = sql<number>`coalesce(sum(${mediaUploads.bytes}), 0)::bigint`;

/**
 * The limits on R2 uploads, counted when the link is handed out: a link is signed for one
 * exact size, so that is the most it can ever put in the bucket. Each account gets
 * `UPLOAD_BYTES_PER_DAY` over any 24 hours, and nobody gets a link once the bucket would
 * pass `BUCKET_MAX_BYTES`.
 */
export function uploadQuota(db: Db, store: MediaStore) {
  let measured: { bytes: number; at: Date } | null = null;

  /**
   * The bucket's size from R2 itself, which also sees files the database has lost track of.
   * When R2 won't say, the database's guess: every posted file, plus every link from the
   * last two days as if it were still sitting in `uploads/`.
   */
  const measure = async (now: Date, log: MediaLog): Promise<number> => {
    try {
      return await store.usage();
    } catch (err) {
      log.warn({ err }, 'Could not measure the R2 bucket; counting from the database instead');
      const [posted] = await db
        .select({ bytes: sql<number>`coalesce(sum(${postMedia.bytes}), 0)::bigint` })
        .from(postMedia)
        .where(isNotNull(postMedia.key));
      const [pending] = await db
        .select({ bytes: total })
        .from(mediaUploads)
        .where(gt(mediaUploads.createdAt, new Date(now.getTime() - KEEP_MS)));
      return Number(posted?.bytes ?? 0) + Number(pending?.bytes ?? 0);
    }
  };

  return {
    /** Throws when this file would take the account past its day, or the bucket past full. */
    async check(userId: string, bytes: number, now: Date, log: MediaLog): Promise<void> {
      const recent = await db
        .select({ bytes: mediaUploads.bytes, createdAt: mediaUploads.createdAt })
        .from(mediaUploads)
        .where(
          and(
            eq(mediaUploads.userId, userId),
            gt(mediaUploads.createdAt, new Date(now.getTime() - DAY_MS)),
          ),
        )
        .orderBy(asc(mediaUploads.createdAt));
      let used = recent.reduce((sum, r) => sum + r.bytes, 0);
      if (used + bytes > UPLOAD_BYTES_PER_DAY) {
        // Room comes back as the oldest uploads turn a day old.
        let at = now.getTime() + DAY_MS;
        for (const r of recent) {
          used -= r.bytes;
          if (used + bytes <= UPLOAD_BYTES_PER_DAY) {
            at = r.createdAt.getTime() + DAY_MS;
            break;
          }
        }
        const wait = at - now.getTime();
        throw new TooManyTries(
          Math.ceil(wait / 1000),
          `You can upload 250 MB a day. This one fits again in ${roughly(wait)}.`,
        );
      }

      if (!measured || now.getTime() - measured.at.getTime() >= MEASURE_EVERY_MS)
        measured = { bytes: await measure(now, log), at: now };
      // Links handed out since then may have filled it some more.
      const [since] = await db
        .select({ bytes: total })
        .from(mediaUploads)
        .where(gte(mediaUploads.createdAt, measured.at));
      if (measured.bytes + Number(since?.bytes ?? 0) + bytes > BUCKET_MAX_BYTES)
        throw new HttpError(503, BUCKET_FULL);
    },

    /** Count a link handed out, and forget the ones too old to matter. */
    async record(userId: string, bytes: number, now: Date): Promise<void> {
      await db.insert(mediaUploads).values({ userId, bytes, createdAt: now });
      await db
        .delete(mediaUploads)
        .where(lt(mediaUploads.createdAt, new Date(now.getTime() - KEEP_MS)));
    },
  };
}
