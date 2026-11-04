import { sessionLine } from '@komogon/core';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { postReports, posts, users } from '../db/schema';
import { loadPosts, type FeedPost } from '../routes/social';
import { loadPeople, type Person } from './people';

/**
 * Reported posts (2026-11-03). Anyone can report a post they can see; each report is kept
 * (`post_reports`, one per person per post), emailed to `REPORTS_EMAIL` the first time, and
 * listed for admins in Admin › Reports, where the post is looked up by its ID (`posts.ref`)
 * and deleted or its reports dismissed.
 */

/** The most someone can say about why they reported a post. */
export const REPORT_REASON_MAX = 500;

export interface AdminReport {
  id: string;
  reporterId: string;
  reporterEmail: string | null;
  reason: string;
  createdAt: string;
}

/** A post as an admin sees it: the post itself, its author's email and its reports. */
export interface AdminPost {
  post: FeedPost;
  authorEmail: string | null;
  /** Newest first; empty for a post looked up that nobody reported. */
  reports: AdminReport[];
}

/** One person, the way the email names them: "Sam (@sam_k) <sam@example.com>". */
function who(person: Person | undefined, email: string | null | undefined): string {
  const name = person?.name ?? 'Someone';
  const handle = person?.username ? ` (@${person.username})` : '';
  return `${name}${handle}${email ? ` <${email}>` : ''}`;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The email a new report sends: the post's ID first, then who, why and what it says. */
export function reportMessage(input: {
  post: FeedPost;
  people: Record<string, Person>;
  authorEmail: string | null;
  reporterId: string;
  reporterEmail: string | null;
  reason: string;
  /** Everyone who has reported this post, this report included. */
  reports: number;
  portalUrl: string;
}): { subject: string; text: string } {
  const { post } = input;
  const videos = post.files.filter((f) => f.mime.startsWith('video/')).length;
  const pictures = post.files.length - videos;
  const files = [
    videos ? count(videos, 'video', 'videos') : null,
    pictures ? count(pictures, 'picture', 'pictures') : null,
  ].filter(Boolean);
  const link = `${input.portalUrl.replace(/\/+$/, '')}/admin?post=${post.ref}`;
  const lines = [
    `Post ${post.ref} was reported.`,
    '',
    `Reason: ${input.reason || '(none given)'}`,
    `Reported by: ${who(input.people[input.reporterId], input.reporterEmail)}`,
    ...(input.reports > 1 ? [`Reports on this post: ${input.reports}`] : []),
    '',
    `Post ID: ${post.ref}`,
    `By: ${who(input.people[post.userId], input.authorEmail)}`,
    `Posted: ${post.createdAt.slice(0, 16).replace('T', ' ')} UTC`,
    ...(post.session
      ? [`Session: ${sessionLine(post.session.minutes, post.session.subject)}`]
      : []),
    ...(post.body ? [`Words: ${post.body}`] : []),
    ...(files.length ? [`Files: ${files.join(', ')}`] : []),
    ...(post.friendsOnly ? ['Friends only'] : []),
    '',
    `Look at it or delete it: ${link}`,
  ];
  return { subject: `Post ${post.ref} reported`, text: lines.join('\n') };
}

/**
 * Posts with what an admin needs beside them, in the order of `ids`. `viewerId` is the
 * admin's own id (it only decides `liked` and `you` on each post).
 */
async function adminPosts(
  db: Db,
  viewerId: string,
  ids: string[],
): Promise<{ posts: AdminPost[]; people: Record<string, Person> }> {
  if (ids.length === 0) return { posts: [], people: {} };
  const [page, reportRows] = await Promise.all([
    loadPosts(db, viewerId, inArray(posts.id, ids), ids.length, { ids: true }),
    db
      .select()
      .from(postReports)
      .where(inArray(postReports.postId, ids))
      .orderBy(desc(postReports.createdAt)),
  ]);
  const accountIds = [
    ...new Set([...page.posts.map((p) => p.userId), ...reportRows.map((r) => r.reporterId)]),
  ];
  const [emailRows, reporters] = await Promise.all([
    accountIds.length
      ? db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(inArray(users.id, accountIds))
      : Promise.resolve([]),
    loadPeople(
      db,
      reportRows.map((r) => r.reporterId),
    ),
  ]);
  const emails = new Map(emailRows.map((u) => [u.id, u.email]));
  const byPost = new Map(page.posts.map((p) => [p.id, p]));
  return {
    posts: ids.flatMap((id) => {
      const post = byPost.get(id);
      if (!post) return [];
      return [
        {
          post,
          authorEmail: emails.get(post.userId) ?? null,
          reports: reportRows
            .filter((r) => r.postId === id)
            .map((r) => ({
              id: r.id,
              reporterId: r.reporterId,
              reporterEmail: emails.get(r.reporterId) ?? null,
              reason: r.reason,
              createdAt: r.createdAt.toISOString(),
            })),
        },
      ];
    }),
    people: { ...reporters, ...page.people },
  };
}

/** Every reported post still up, the most recently reported first (at most 100). */
export async function listReportedPosts(db: Db, viewerId: string) {
  const rows = await db
    .select({ postId: postReports.postId, last: sql<string>`max(${postReports.createdAt})` })
    .from(postReports)
    .groupBy(postReports.postId)
    .orderBy(desc(sql`max(${postReports.createdAt})`))
    .limit(100);
  return adminPosts(
    db,
    viewerId,
    rows.map((r) => r.postId),
  );
}

/** One post by its ID (the number a report names) or its uuid; null when there is none. */
export async function findPostForAdmin(db: Db, viewerId: string, key: string) {
  const ref = /^\d{1,9}$/.test(key) ? Number(key) : null;
  const row = await db.query.posts.findFirst({
    where: ref !== null ? eq(posts.ref, ref) : eq(posts.id, key),
    columns: { id: true },
  });
  if (!row) return null;
  const found = await adminPosts(db, viewerId, [row.id]);
  return found.posts[0] ? { post: found.posts[0], people: found.people } : null;
}

/** Drop a post's reports and keep the post. */
export async function dismissReports(db: Db, postId: string): Promise<void> {
  await db.delete(postReports).where(eq(postReports.postId, postId));
}
