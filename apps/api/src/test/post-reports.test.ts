import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TimerState } from '@komogon/core';
import { signDevToken } from '../auth/verify';
import { sessions } from '../db/schema';
import { createLocalMailer, type Mailer } from '../services/mailer';
import { advanceClock, createTestApp, TEST_SECRET, USER_A, USER_B, type TestApp } from './helpers';

const ADMIN = { id: '33333333-3333-4333-8333-333333333333', email: 'boss@example.com' };
const JPEG = 'data:image/jpeg;base64,/9j/4AAQ';

let t: TestApp;
let mailer: Mailer;
let adminToken: string;

const finished = (userId: string, startedAt: string) => ({
  userId,
  startedAt: new Date(startedAt),
  endedAt: new Date(Date.parse(startedAt) + 45 * 60_000),
  mode: 'unlimited' as const,
  workSeconds: 45 * 60,
  timer: {} as TimerState,
});

/**
 * A post by `token`'s account about a fresh session, with `body` and a picture. Its ID
 * (`ref`) comes from an admin, since the author isn't sent it.
 */
async function postAs(token: string, userId: string, startedAt: string, body: string) {
  const [s] = await t.db.insert(sessions).values(finished(userId, startedAt)).returning();
  const res = await t.api({
    method: 'POST',
    url: '/api/social/posts',
    token,
    payload: { body, sessionId: s!.id, media: JPEG },
  });
  expect(res.statusCode).toBe(201);
  const { id, ref } = res.json().post as { id: string; ref?: number };
  expect(ref).toBeUndefined();
  const found = await t.api({ method: 'GET', url: `/api/admin/posts/${id}`, token: adminToken });
  return { id, ref: found.json().post.post.ref as number };
}

beforeAll(async () => {
  mailer = createLocalMailer();
  t = await createTestApp('2026-11-03T14:00:00.000Z', {
    adminEmails: [ADMIN.email],
    mailer,
    reportsEmail: 'owner@example.com',
    calendar: { portalUrl: 'https://www.komogon.app/' },
  });
  adminToken = await signDevToken(TEST_SECRET, ADMIN);
  for (const token of [t.tokenA, t.tokenB, adminToken]) {
    await t.api({ method: 'GET', url: '/api/me', token });
    await t.api({ method: 'PATCH', url: '/api/me', token, payload: { onboarded: true } });
  }
  await t.api({ method: 'PATCH', url: '/api/me/settings', payload: { profile: { name: 'Ada' } } });
  await t.api({
    method: 'PATCH',
    url: '/api/me/settings',
    token: t.tokenB,
    payload: { profile: { name: 'Ben' } },
  });
});
afterAll(() => t.close());

describe('post IDs, reports and admins deleting posts', () => {
  let first: { id: string; ref: number };
  let second: { id: string; ref: number };

  it('numbers every post, counting up', async () => {
    first = await postAs(t.tokenA, USER_A.id, '2026-11-03T09:00:00Z', 'Morning set.');
    // Posted a little later, so the feed's newest-first order is certain.
    advanceClock(t, 5);
    second = await postAs(t.tokenA, USER_A.id, '2026-11-03T11:00:00Z', 'Buy cheap pills here');
    expect(typeof first.ref).toBe('number');
    expect(second.ref).toBeGreaterThan(first.ref);
    const feed = await t.api({ method: 'GET', url: '/api/social/feed', token: adminToken });
    expect(feed.json().posts.map((p: { ref: number }) => p.ref)).toEqual([second.ref, first.ref]);
  });

  it('sends the IDs to admins only', async () => {
    const refs = (res: { json: () => { posts: { ref?: number }[] } }) =>
      res.json().posts.map((p) => p.ref);
    for (const token of [t.tokenA, t.tokenB]) {
      const feed = await t.api({ method: 'GET', url: '/api/social/feed', token });
      expect(refs(feed)).toEqual([undefined, undefined]);
      const profile = await t.api({ method: 'GET', url: `/api/profiles/${USER_A.id}`, token });
      expect(profile.statusCode).toBe(200);
      expect(refs(profile)).toEqual([undefined, undefined]);
    }
    const edited = await t.api({
      method: 'PATCH',
      url: `/api/posts/${first.id}`,
      payload: { body: 'Morning set.' },
    });
    expect(edited.json().post.ref).toBeUndefined();
    const profile = await t.api({
      method: 'GET',
      url: `/api/profiles/${USER_A.id}`,
      token: adminToken,
    });
    expect(refs(profile)).toEqual([second.ref, first.ref]);
  });

  it('refuses a report of your own post or one you cannot see', async () => {
    const own = await t.api({ method: 'POST', url: `/api/posts/${second.id}/report`, payload: {} });
    expect(own.statusCode).toBe(400);
    const none = await t.api({
      method: 'POST',
      url: '/api/posts/99999999-9999-4999-8999-999999999999/report',
      token: t.tokenB,
      payload: {},
    });
    expect(none.statusCode).toBe(404);
    expect(mailer.messages).toHaveLength(0);
  });

  it('keeps a report and emails it once, with the post ID and a link', async () => {
    const res = await t.api({
      method: 'POST',
      url: `/api/posts/${second.id}/report`,
      token: t.tokenB,
      payload: { reason: 'Spam' },
    });
    expect(res.statusCode).toBe(201);
    expect(mailer.messages).toHaveLength(1);
    const mail = mailer.messages![0]!;
    expect(mail.to).toBe('owner@example.com');
    expect(mail.subject).toBe(`Post ${second.ref} reported`);
    expect(mail.text).toContain(`Post ID: ${second.ref}`);
    expect(mail.text).toContain('Reason: Spam');
    expect(mail.text).toContain('Reported by: Ben');
    expect(mail.text).toContain('<b@example.com>');
    expect(mail.text).toContain('By: Ada');
    expect(mail.text).toContain('<a@example.com>');
    expect(mail.text).toContain('Words: Buy cheap pills here');
    expect(mail.text).toContain('Files: 1 picture');
    expect(mail.text).toContain(`https://www.komogon.app/admin?post=${second.ref}`);

    // Reporting again only updates what they said; no second email.
    const again = await t.api({
      method: 'POST',
      url: `/api/posts/${second.id}/report`,
      token: t.tokenB,
      payload: { reason: 'Spam, selling pills' },
    });
    expect(again.statusCode).toBe(200);
    expect(mailer.messages).toHaveLength(1);
  });

  it('lists reported posts for admins only, and finds a post by its ID', async () => {
    const notAdmin = await t.api({ method: 'GET', url: '/api/admin/reports', token: t.tokenB });
    expect(notAdmin.statusCode).toBe(403);

    const list = await t.api({ method: 'GET', url: '/api/admin/reports', token: adminToken });
    expect(list.statusCode).toBe(200);
    const { posts, people } = list.json();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      post: { id: second.id, ref: second.ref, body: 'Buy cheap pills here' },
      authorEmail: USER_A.email,
      reports: [
        { reporterId: USER_B.id, reporterEmail: USER_B.email, reason: 'Spam, selling pills' },
      ],
    });
    expect(people[USER_B.id].name).toBe('Ben');
    expect(people[USER_A.id].name).toBe('Ada');

    for (const key of [String(first.ref), `%23${first.ref}`, first.id]) {
      const one = await t.api({ method: 'GET', url: `/api/admin/posts/${key}`, token: adminToken });
      expect(one.statusCode).toBe(200);
      expect(one.json().post).toMatchObject({ post: { id: first.id }, reports: [] });
    }
    const missing = await t.api({
      method: 'GET',
      url: '/api/admin/posts/987654',
      token: adminToken,
    });
    expect(missing.statusCode).toBe(404);
    const junk = await t.api({ method: 'GET', url: '/api/admin/posts/drop', token: adminToken });
    expect(junk.statusCode).toBe(400);
  });

  it('lets an admin open the files of a post they could not otherwise see', async () => {
    await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { social: { posts: 'friends' } },
    });
    const stranger = await t.api({
      method: 'GET',
      url: `/api/posts/${second.id}/media/url`,
      token: t.tokenB,
    });
    expect(stranger.statusCode).toBe(404);
    const admin = await t.api({
      method: 'GET',
      url: `/api/posts/${second.id}/media/url`,
      token: adminToken,
    });
    expect(admin.statusCode).toBe(200);
    await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { social: { posts: 'everyone' } },
    });
  });

  it('dismissing keeps the post and drops its reports', async () => {
    await t.api({
      method: 'POST',
      url: `/api/posts/${first.id}/report`,
      token: t.tokenB,
      payload: {},
    });
    expect(mailer.messages).toHaveLength(2);
    expect(mailer.messages![1]!.text).toContain('Reason: (none given)');
    const res = await t.api({
      method: 'DELETE',
      url: `/api/admin/posts/${first.id}/reports`,
      token: adminToken,
    });
    expect(res.statusCode).toBe(204);
    const list = await t.api({ method: 'GET', url: '/api/admin/reports', token: adminToken });
    expect(list.json().posts.map((p: { post: { id: string } }) => p.post.id)).toEqual([second.id]);
  });

  it('only the author or an admin deletes a post, and its reports go with it', async () => {
    const other = await t.api({
      method: 'DELETE',
      url: `/api/posts/${second.id}`,
      token: t.tokenB,
    });
    expect(other.statusCode).toBe(404);
    const admin = await t.api({
      method: 'DELETE',
      url: `/api/posts/${second.id}`,
      token: adminToken,
    });
    expect(admin.statusCode).toBe(204);
    const list = await t.api({ method: 'GET', url: '/api/admin/reports', token: adminToken });
    expect(list.json().posts).toEqual([]);
    const gone = await t.api({
      method: 'GET',
      url: `/api/admin/posts/${second.ref}`,
      token: adminToken,
    });
    expect(gone.statusCode).toBe(404);
  });
});
