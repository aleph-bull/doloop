import type { FastifyInstance } from 'fastify';
import { withDefaults, type UserSettings } from '@komogon/core';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import {
  friendships,
  nodes,
  postComments,
  postLikes,
  postMedia,
  posts,
  routines,
  sessions,
  users,
} from '../db/schema';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { loadPeople, type Person } from '../services/people';
import { dt } from '../services/sessions-mapper';
import { uuid } from '../validation';

export const POST_MAX_LENGTH = 500;
export const COMMENT_MAX_LENGTH = 500;
/** The largest video a post may carry, before base64. */
export const POST_VIDEO_MAX_BYTES = 5 * 1024 * 1024;
/** The largest picture a post may carry. */
export const POST_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const POST_POSTER_MAX_BYTES = 200 * 1024;
export const FEED_PAGE = 20;

const VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface FeedPost {
  id: string;
  userId: string;
  body: string;
  createdAt: string;
  /** The session shared, as it was when shared. */
  session: { minutes: number; subject: string | null } | null;
  /** The attached video or picture; the bytes come from GET /api/posts/:id/media. */
  media: { mime: string; bytes: number; poster: string | null } | null;
  likes: number;
  liked: boolean;
  comments: number;
  you: boolean;
}

export interface FeedComment {
  id: string;
  postId: string;
  userId: string;
  body: string;
  createdAt: string;
  you: boolean;
}

export type FriendshipState = 'none' | 'friends' | 'requested' | 'incoming';

/** Where you stand with someone, and the request to act on when there is one. */
export interface FriendshipStatus {
  status: FriendshipState;
  requestId: string | null;
}

/** Parses a data URL into what the row stores, checking the type and the size. */
function parseDataUrl(
  dataUrl: string,
  allowed: Set<string>,
  maxBytes: number,
  what: string,
): { mime: string; data: string; bytes: number } {
  const m = dataUrl.match(/^data:([a-z0-9/+.-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!m) throw badRequest(`Expected a base64 data URL for the ${what}`);
  const mime = m[1]!.toLowerCase();
  if (!allowed.has(mime)) throw badRequest(`Use ${[...allowed].join(' or ')} for the ${what}`);
  const padding = m[2]!.match(/=+$/)?.[0].length ?? 0;
  const bytes = Math.floor((m[2]!.length * 3) / 4) - padding;
  if (bytes > maxBytes)
    throw badRequest(
      `The ${what} must be under ${maxBytes >= 1024 * 1024 ? `${Math.round(maxBytes / 1024 / 1024)} MB` : `${Math.round(maxBytes / 1024)} KB`}`,
    );
  return { mime, data: m[2]!, bytes };
}

/** Settings › Social, with the defaults filled in. */
export const socialOf = (settings: Partial<UserSettings> | null | undefined) =>
  withDefaults(settings).social;

/** The ids of everyone you are friends with, either way round. */
export async function friendIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ a: friendships.requesterId, b: friendships.addresseeId })
    .from(friendships)
    .where(
      and(
        eq(friendships.status, 'accepted'),
        or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId)),
      ),
    );
  return rows.map((r) => (r.a === userId ? r.b : r.a));
}

/** Where you stand with one person. */
export async function friendshipWith(db: Db, me: string, other: string): Promise<FriendshipStatus> {
  if (me === other) return { status: 'none', requestId: null };
  const row = await db.query.friendships.findFirst({
    where: or(
      and(eq(friendships.requesterId, me), eq(friendships.addresseeId, other)),
      and(eq(friendships.requesterId, other), eq(friendships.addresseeId, me)),
    ),
  });
  if (!row) return { status: 'none', requestId: null };
  if (row.status === 'accepted') return { status: 'friends', requestId: row.id };
  return { status: row.requesterId === me ? 'requested' : 'incoming', requestId: row.id };
}

/**
 * Posts with their counts, newest first, and the people behind them. `where` picks the
 * posts; the viewer decides `liked` and `you`.
 */
export async function loadPosts(
  db: Db,
  viewerId: string,
  where: ReturnType<typeof and>,
  limit: number,
): Promise<{ posts: FeedPost[]; people: Record<string, Person> }> {
  // Written out by hand: in a select list drizzle drops the table from `posts.id`, and a
  // bare "id" inside the comments subquery would be the comment's own id.
  const likes = sql<number>`(select count(*) from post_likes l where l.post_id = posts.id)::int`;
  const liked = sql<boolean>`exists(select 1 from post_likes l where l.post_id = posts.id and l.user_id = ${viewerId})`;
  const comments = sql<number>`(select count(*) from post_comments c where c.post_id = posts.id)::int`;
  const rows = await db
    .select({
      id: posts.id,
      userId: posts.userId,
      body: posts.body,
      createdAt: posts.createdAt,
      minutes: posts.minutes,
      subject: posts.subject,
      mediaMime: posts.mediaMime,
      mediaBytes: posts.mediaBytes,
      poster: posts.poster,
      likes,
      liked,
      comments,
    })
    .from(posts)
    .where(where)
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(limit);
  const people = await loadPeople(
    db,
    rows.map((r) => r.userId),
  );
  return {
    posts: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      body: r.body,
      createdAt: r.createdAt.toISOString(),
      session: r.minutes === null ? null : { minutes: r.minutes, subject: r.subject },
      media:
        r.mediaMime && r.mediaBytes !== null
          ? { mime: r.mediaMime, bytes: r.mediaBytes, poster: r.poster }
          : null,
      likes: Number(r.likes),
      liked: Boolean(r.liked),
      comments: Number(r.comments),
      you: r.userId === viewerId,
    })),
    people,
  };
}

/**
 * Social: the feed of posts, likes and comments, friends and friend requests. Jams are
 * in routes/jams.ts. Everything here shows only what people chose to
 * share plus finished-session totals; emails, settings and tasks never leave an account.
 */
export function socialRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  const idParam = z.object({ id: uuid });

  /* ---------- the feed ---------- */

  app.get('/api/social/feed', async (req) => {
    const q = z
      .object({
        scope: z.enum(['everyone', 'friends']).default('everyone'),
        before: z.iso.datetime({ offset: true }).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(FEED_PAGE),
      })
      .parse(req.query);
    const conds = [];
    if (q.before) conds.push(lt(posts.createdAt, dt(q.before)));
    const circle = [req.user.id, ...(await friendIds(db, req.user.id))];
    // Posts someone keeps to friends (Settings › Social) show only to them and their friends.
    conds.push(
      or(
        inArray(posts.userId, circle),
        sql`(select coalesce(u.settings -> 'social' ->> 'posts', 'everyone') from users u where u.id = posts.user_id) <> 'friends'`,
      )!,
    );
    if (q.scope === 'friends') conds.push(inArray(posts.userId, circle));
    const page = await loadPosts(
      db,
      req.user.id,
      conds.length ? and(...conds) : undefined,
      q.limit,
    );
    const last = page.posts[page.posts.length - 1];
    return {
      ...page,
      nextBefore: page.posts.length === q.limit && last ? last.createdAt : null,
    };
  });

  app.post('/api/social/posts', async (req, reply) => {
    const input = z
      .object({
        body: z.string().trim().max(POST_MAX_LENGTH).default(''),
        sessionId: uuid.optional(),
        media: z
          .string()
          .max(POST_VIDEO_MAX_BYTES * 1.4)
          .optional(),
        poster: z
          .string()
          .max(POST_POSTER_MAX_BYTES * 1.4)
          .optional(),
      })
      .parse(req.body);
    if (!input.body && !input.sessionId && !input.media)
      throw badRequest('Say something, or share a session or a video');

    let minutes: number | null = null;
    let subject: string | null = null;
    if (input.sessionId) {
      // Only your own finished sessions, so the numbers on a post are always real ones.
      const s = await db.query.sessions.findFirst({
        where: and(eq(sessions.id, input.sessionId), eq(sessions.userId, req.user.id)),
      });
      if (!s || !s.endedAt) throw notFound('No such session');
      minutes = Math.round(s.workSeconds / 60);
      if (s.nodeId) {
        const n = await db.query.nodes.findFirst({ where: eq(nodes.id, s.nodeId) });
        subject = n?.title ?? null;
      } else if (s.routineId) {
        const r = await db.query.routines.findFirst({ where: eq(routines.id, s.routineId) });
        subject = r?.title ?? null;
      }
    }

    // A video, or a picture: the type says which, and each has its own size.
    const media = input.media
      ? /^data:image\//i.test(input.media)
        ? parseDataUrl(input.media, IMAGE_TYPES, POST_IMAGE_MAX_BYTES, 'picture')
        : parseDataUrl(input.media, VIDEO_TYPES, POST_VIDEO_MAX_BYTES, 'video')
      : null;
    const poster = input.poster
      ? parseDataUrl(
          input.poster,
          new Set(['image/jpeg', 'image/webp']),
          POST_POSTER_MAX_BYTES,
          'poster',
        )
      : null;
    if (poster && !media?.mime.startsWith('video/')) throw badRequest('A poster goes with a video');

    const post = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(posts)
        .values({
          userId: req.user.id,
          body: input.body,
          sessionId: input.sessionId ?? null,
          minutes,
          subject,
          mediaMime: media?.mime ?? null,
          mediaBytes: media?.bytes ?? null,
          poster: poster ? `data:${poster.mime};base64,${poster.data}` : null,
          createdAt: dt(clock()),
        })
        .returning({ id: posts.id });
      if (media)
        await tx
          .insert(postMedia)
          .values({ postId: row!.id, mime: media.mime, data: media.data, bytes: media.bytes });
      return row!;
    });
    const page = await loadPosts(db, req.user.id, eq(posts.id, post.id), 1);
    return reply.code(201).send({ post: page.posts[0], people: page.people });
  });

  app.delete('/api/posts/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    // Only your own: a post that isn't yours reads as not there.
    const deleted = await db
      .delete(posts)
      .where(and(eq(posts.id, id), eq(posts.userId, req.user.id)))
      .returning({ id: posts.id });
    if (deleted.length === 0) throw notFound('No such post');
    return reply.code(204).send();
  });

  /** The video itself, as bytes. The portal fetches it with the token and plays a blob. */
  app.get('/api/posts/:id/media', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const row = await db.query.postMedia.findFirst({ where: eq(postMedia.postId, id) });
    if (!row) throw notFound('No video on this post');
    return reply
      .type(row.mime)
      .header('cache-control', 'private, max-age=3600')
      .send(Buffer.from(row.data, 'base64'));
  });

  /* ---------- likes and comments ---------- */

  const postExists = async (id: string) => {
    const row = await db.query.posts.findFirst({ where: eq(posts.id, id), columns: { id: true } });
    if (!row) throw notFound('No such post');
  };

  const likeCounts = async (id: string, userId: string) => {
    const [row] = await db
      .select({
        likes: sql<number>`count(*)::int`,
        liked: sql<boolean>`bool_or(${postLikes.userId} = ${userId})`,
      })
      .from(postLikes)
      .where(eq(postLikes.postId, id));
    return { likes: Number(row?.likes ?? 0), liked: Boolean(row?.liked) };
  };

  app.post('/api/posts/:id/like', async (req) => {
    const { id } = idParam.parse(req.params);
    await postExists(id);
    await db
      .insert(postLikes)
      .values({ postId: id, userId: req.user.id, createdAt: dt(clock()) })
      .onConflictDoNothing();
    return likeCounts(id, req.user.id);
  });

  app.delete('/api/posts/:id/like', async (req) => {
    const { id } = idParam.parse(req.params);
    await postExists(id);
    await db
      .delete(postLikes)
      .where(and(eq(postLikes.postId, id), eq(postLikes.userId, req.user.id)));
    return likeCounts(id, req.user.id);
  });

  const toComment = (r: typeof postComments.$inferSelect, me: string): FeedComment => ({
    id: r.id,
    postId: r.postId,
    userId: r.userId,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
    you: r.userId === me,
  });

  app.get('/api/posts/:id/comments', async (req) => {
    const { id } = idParam.parse(req.params);
    await postExists(id);
    const rows = await db.query.postComments.findMany({
      where: eq(postComments.postId, id),
      orderBy: [postComments.createdAt],
      limit: 200,
    });
    const people = await loadPeople(
      db,
      rows.map((r) => r.userId),
    );
    return { comments: rows.map((r) => toComment(r, req.user.id)), people };
  });

  app.post('/api/posts/:id/comments', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { body } = z
      .object({ body: z.string().trim().min(1).max(COMMENT_MAX_LENGTH) })
      .parse(req.body);
    await postExists(id);
    const [row] = await db
      .insert(postComments)
      .values({ postId: id, userId: req.user.id, body, createdAt: dt(clock()) })
      .returning();
    const people = await loadPeople(db, [req.user.id]);
    return reply.code(201).send({ comment: toComment(row!, req.user.id), people });
  });

  /** Your own comment, or any comment on your own post. */
  app.delete('/api/comments/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const row = await db.query.postComments.findFirst({ where: eq(postComments.id, id) });
    if (!row) throw notFound('No such comment');
    if (row.userId !== req.user.id) {
      const post = await db.query.posts.findFirst({
        where: eq(posts.id, row.postId),
        columns: { userId: true },
      });
      if (post?.userId !== req.user.id) throw forbidden('Not your comment');
    }
    await db.delete(postComments).where(eq(postComments.id, id));
    return reply.code(204).send();
  });

  /* ---------- friends ---------- */

  app.get('/api/social/friends', async (req) => {
    const me = req.user.id;
    const rows = await db.query.friendships.findMany({
      where: or(eq(friendships.requesterId, me), eq(friendships.addresseeId, me)),
      orderBy: [desc(friendships.createdAt)],
    });
    const friends = rows
      .filter((r) => r.status === 'accepted')
      .map((r) => ({
        userId: r.requesterId === me ? r.addresseeId : r.requesterId,
        since: (r.respondedAt ?? r.createdAt).toISOString(),
      }));
    const incoming = rows
      .filter((r) => r.status === 'pending' && r.addresseeId === me)
      .map((r) => ({ id: r.id, userId: r.requesterId, at: r.createdAt.toISOString() }));
    const outgoing = rows
      .filter((r) => r.status === 'pending' && r.requesterId === me)
      .map((r) => ({ id: r.id, userId: r.addresseeId, at: r.createdAt.toISOString() }));
    const people = await loadPeople(db, [
      ...friends.map((f) => f.userId),
      ...incoming.map((r) => r.userId),
      ...outgoing.map((r) => r.userId),
    ]);
    return { friends, incoming, outgoing, people };
  });

  /** People by name, to find someone to add. Only accounts that finished onboarding. */
  app.get('/api/social/people', async (req) => {
    const { q } = z.object({ q: z.string().trim().min(1).max(60) }).parse(req.query);
    const name = sql`${users.settings} -> 'profile' ->> 'name'`;
    const rows = await db
      .select({ id: users.id, settings: users.settings })
      .from(users)
      .where(
        and(
          sql`${users.onboardedAt} is not null`,
          sql`${users.id} <> ${req.user.id}`,
          sql`${name} ilike ${'%' + q.replace(/[%_\\]/g, '\\$&') + '%'}`,
        ),
      )
      .orderBy(sql`lower(${name})`)
      .limit(8);
    const people = await loadPeople(
      db,
      rows.map((r) => r.id),
    );
    const results = await Promise.all(
      rows.map(async (r) => ({
        userId: r.id,
        friendship: await friendshipWith(db, req.user.id, r.id),
        acceptsRequests: socialOf(r.settings).requests,
      })),
    );
    return { results, people };
  });

  app.post('/api/social/friends/requests', async (req, reply) => {
    const { userId } = z.object({ userId: uuid }).parse(req.body);
    const me = req.user.id;
    if (userId === me) throw badRequest('That is you');
    const other = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true, onboardedAt: true, settings: true },
    });
    if (!other || other.onboardedAt === null) throw notFound('No such person');
    if (!socialOf(other.settings).requests) throw forbidden('Not taking friend requests');
    const current = await friendshipWith(db, me, userId);
    if (current.status === 'friends') throw conflict('You are already friends');
    if (current.status === 'requested') throw conflict('Already asked');
    const now = dt(clock());
    if (current.status === 'incoming') {
      // They asked first: asking back is the same as saying yes.
      await db
        .update(friendships)
        .set({ status: 'accepted', respondedAt: now })
        .where(eq(friendships.id, current.requestId!));
      return reply.code(200).send({ friendship: await friendshipWith(db, me, userId) });
    }
    await db.insert(friendships).values({ requesterId: me, addresseeId: userId, createdAt: now });
    return reply.code(201).send({ friendship: await friendshipWith(db, me, userId) });
  });

  app.post('/api/social/friends/requests/:id/accept', async (req) => {
    const { id } = idParam.parse(req.params);
    const row = await db.query.friendships.findFirst({ where: eq(friendships.id, id) });
    if (!row || row.addresseeId !== req.user.id) throw notFound('No such request');
    if (row.status === 'pending')
      await db
        .update(friendships)
        .set({ status: 'accepted', respondedAt: dt(clock()) })
        .where(eq(friendships.id, id));
    return { friendship: await friendshipWith(db, req.user.id, row.requesterId) };
  });

  /** Decline a request made to you, or take back one you made. */
  app.delete('/api/social/friends/requests/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const row = await db.query.friendships.findFirst({ where: eq(friendships.id, id) });
    const mine = row && (row.addresseeId === req.user.id || row.requesterId === req.user.id);
    if (!row || !mine || row.status !== 'pending') throw notFound('No such request');
    await db.delete(friendships).where(eq(friendships.id, id));
    return reply.code(204).send();
  });

  app.delete('/api/social/friends/:userId', async (req, reply) => {
    const { userId } = z.object({ userId: uuid }).parse(req.params);
    const me = req.user.id;
    await db
      .delete(friendships)
      .where(
        and(
          eq(friendships.status, 'accepted'),
          or(
            and(eq(friendships.requesterId, me), eq(friendships.addresseeId, userId)),
            and(eq(friendships.requesterId, userId), eq(friendships.addresseeId, me)),
          ),
        ),
      );
    return reply.code(204).send();
  });
}
