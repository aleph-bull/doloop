import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, inArray, isNull, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import { groups, nudges, postComments, postLikes, posts, users } from '../db/schema';
import { loadPeople, type Person } from '../services/people';
import { dt } from '../services/sessions-mapper';

/** How far back the bell looks. */
export const NOTIFICATIONS_DAYS = 30;
/** The most it lists, newest first. */
export const NOTIFICATIONS_MAX = 60;

export type NotificationKind = 'kudos' | 'comment' | 'nudge';

export interface SocialNotification {
  /** Unique across kinds (`kudos:<post>:<person>`, `comment:<id>`, `nudge:<id>`). */
  id: string;
  kind: NotificationKind;
  fromId: string;
  at: string;
  /** Later than the last time the bell was opened. */
  unread: boolean;
  /** The post it is about (kudos and comments); its details are in `posts`. */
  postId: string | null;
  /** What the comment said. */
  comment: string | null;
  /** The group a nudge came from, when it did. */
  groupName: string | null;
}

/** Just enough of your post to tell which one it was. */
export interface NotificationPost {
  id: string;
  body: string;
  subject: string | null;
  minutes: number | null;
  mime: string | null;
  poster: string | null;
}

/**
 * The bell on Social: who gave kudos to your posts, who commented on them and who nudged
 * you, newest first, over the last 30 days. It reads the rows Social already keeps
 * (`post_likes`, `post_comments`, `nudges`); what is new is anything after
 * `users.notifications_seen_at`, which opening the bell moves on. Your own kudos and
 * comments on your own posts aren't news, and a suspended account's are left out, as on
 * the feed.
 */
export function notificationRoutes(app: FastifyInstance, db: Db, clock: () => string) {
  app.get('/api/social/notifications', async (req) => {
    const me = req.user.id;
    const since = new Date(dt(clock()).getTime() - NOTIFICATIONS_DAYS * 24 * 60 * 60_000);
    const [kudos, comments, nudged] = await Promise.all([
      db
        .select({ postId: postLikes.postId, fromId: postLikes.userId, at: postLikes.createdAt })
        .from(postLikes)
        .innerJoin(posts, eq(posts.id, postLikes.postId))
        .innerJoin(users, eq(users.id, postLikes.userId))
        .where(
          and(
            eq(posts.userId, me),
            ne(postLikes.userId, me),
            gte(postLikes.createdAt, since),
            isNull(users.bannedAt),
          ),
        )
        .orderBy(desc(postLikes.createdAt))
        .limit(NOTIFICATIONS_MAX),
      db
        .select({
          id: postComments.id,
          postId: postComments.postId,
          fromId: postComments.userId,
          body: postComments.body,
          at: postComments.createdAt,
        })
        .from(postComments)
        .innerJoin(posts, eq(posts.id, postComments.postId))
        .innerJoin(users, eq(users.id, postComments.userId))
        .where(
          and(
            eq(posts.userId, me),
            ne(postComments.userId, me),
            gte(postComments.createdAt, since),
            isNull(users.bannedAt),
          ),
        )
        .orderBy(desc(postComments.createdAt))
        .limit(NOTIFICATIONS_MAX),
      db
        .select({ id: nudges.id, fromId: nudges.fromId, groupName: groups.name, at: nudges.at })
        .from(nudges)
        .innerJoin(users, eq(users.id, nudges.fromId))
        .leftJoin(groups, eq(groups.id, nudges.groupId))
        .where(and(eq(nudges.toId, me), gte(nudges.at, since), isNull(users.bannedAt)))
        .orderBy(desc(nudges.at))
        .limit(NOTIFICATIONS_MAX),
    ]);

    const seenAt = req.user.notificationsSeenAt;
    const unread = (at: Date) => !seenAt || at > seenAt;
    const all: Array<SocialNotification & { time: number }> = [
      ...kudos.map((k) => ({
        id: `kudos:${k.postId}:${k.fromId}`,
        kind: 'kudos' as const,
        fromId: k.fromId,
        at: k.at.toISOString(),
        time: k.at.getTime(),
        unread: unread(k.at),
        postId: k.postId,
        comment: null,
        groupName: null,
      })),
      ...comments.map((c) => ({
        id: `comment:${c.id}`,
        kind: 'comment' as const,
        fromId: c.fromId,
        at: c.at.toISOString(),
        time: c.at.getTime(),
        unread: unread(c.at),
        postId: c.postId,
        comment: c.body,
        groupName: null,
      })),
      ...nudged.map((n) => ({
        id: `nudge:${n.id}`,
        kind: 'nudge' as const,
        fromId: n.fromId,
        at: n.at.toISOString(),
        time: n.at.getTime(),
        unread: unread(n.at),
        postId: null,
        comment: null,
        groupName: n.groupName,
      })),
    ];
    all.sort((a, b) => b.time - a.time);
    const notifications = all.slice(0, NOTIFICATIONS_MAX).map(({ time: _, ...n }) => n);

    const postIds = [...new Set(notifications.flatMap((n) => (n.postId ? [n.postId] : [])))];
    const postRows = postIds.length
      ? await db.query.posts.findMany({
          where: inArray(posts.id, postIds),
          columns: {
            id: true,
            body: true,
            subject: true,
            minutes: true,
            mediaMime: true,
            poster: true,
          },
        })
      : [];
    const people: Record<string, Person> = await loadPeople(
      db,
      notifications.map((n) => n.fromId),
    );
    return {
      notifications,
      posts: Object.fromEntries(
        postRows.map((p): [string, NotificationPost] => [
          p.id,
          {
            id: p.id,
            body: p.body,
            subject: p.subject,
            minutes: p.minutes,
            mime: p.mediaMime,
            poster: p.poster,
          },
        ]),
      ),
      people,
      unread: notifications.filter((n) => n.unread).length,
    };
  });

  /** The bell was opened: everything so far has been seen. */
  app.post('/api/social/notifications/seen', async (req, reply) => {
    await db
      .update(users)
      .set({ notificationsSeenAt: dt(clock()) })
      .where(eq(users.id, req.user.id));
    return reply.code(204).send();
  });
}
