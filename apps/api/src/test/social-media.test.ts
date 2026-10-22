import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TimerState } from '@komogon/core';
import { eq } from 'drizzle-orm';
import { postMedia, sessions } from '../db/schema';
import { createR2Store, type MediaStore } from '../services/media-store';
import { createTestApp, USER_A, USER_B, type TestApp } from './helpers';

/** R2 kept in a Map. A read link is a data URL, so the pass-through route can fetch it. */
function memoryStore() {
  const files = new Map<string, { mime: string; bytes: Buffer }>();
  const store: MediaStore = {
    uploadUrl: async (key, mime, bytes, expiresIn) =>
      `https://r2.test/bucket/${key}?mime=${mime}&bytes=${bytes}&expires=${expiresIn}`,
    readUrl: async (key) => {
      const f = files.get(key);
      return f ? `data:${f.mime};base64,${f.bytes.toString('base64')}` : 'data:,missing';
    },
    head: async (key) => {
      const f = files.get(key);
      return f ? { bytes: f.bytes.length, mime: f.mime } : null;
    },
    copy: async (from, to) => {
      const f = files.get(from);
      if (!f) throw new Error('no such file');
      files.set(to, f);
    },
    remove: async (key) => {
      files.delete(key);
    },
  };
  /** What the browser's PUT would leave behind. */
  const put = (key: string, mime: string, bytes: Buffer) => files.set(key, { mime, bytes });
  return { store, files, put };
}

const finished = (userId: string, startedAt: string, workSeconds: number) => ({
  userId,
  startedAt: new Date(startedAt),
  endedAt: new Date(Date.parse(startedAt) + workSeconds * 1000),
  mode: 'unlimited' as const,
  workSeconds,
  timer: {} as TimerState,
});

const JPEG = 'data:image/jpeg;base64,/9j/4AAQ';
const MB = 1024 * 1024;

describe('post media in R2', () => {
  const r2 = memoryStore();
  let t: TestApp;
  let sessionA: string;
  let sessionB: string;

  beforeAll(async () => {
    t = await createTestApp('2026-09-23T14:00:00.000Z', { mediaStore: r2.store });
    for (const token of [t.tokenA, t.tokenB]) {
      await t.api({ method: 'GET', url: '/api/me', token });
      await t.api({ method: 'PATCH', url: '/api/me', token, payload: { onboarded: true } });
    }
    const [a] = await t.db
      .insert(sessions)
      .values(finished(USER_A.id, '2026-09-23T10:00:00Z', 3600))
      .returning();
    const [b] = await t.db
      .insert(sessions)
      .values(finished(USER_B.id, '2026-09-23T11:00:00Z', 1800))
      .returning();
    sessionA = a!.id;
    sessionB = b!.id;
  });
  afterAll(() => t.close());

  /** Ask for a link and "upload" through it, as the portal does. */
  const upload = async (mime: string, bytes: Buffer, token = t.tokenA) => {
    const res = await t.api({
      method: 'POST',
      url: '/api/social/uploads',
      token,
      payload: { mime, bytes: bytes.length },
    });
    expect(res.statusCode).toBe(200);
    const { key } = res.json() as { key: string };
    r2.put(key, mime, bytes);
    return key;
  };

  it('says videos go straight to R2, up to 40 MB', async () => {
    const res = await t.api({ method: 'GET', url: '/api/social/uploads' });
    expect(res.json()).toEqual({ direct: true, videoMaxBytes: 40 * MB, imageMaxBytes: 2 * MB });
  });

  it('gives an upload link only for a type and size it would take', async () => {
    const ok = await t.api({
      method: 'POST',
      url: '/api/social/uploads',
      payload: { mime: 'video/mp4', bytes: 39 * MB },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as { key: string; url: string; headers: Record<string, string> };
    expect(body.key).toMatch(new RegExp(`^uploads/${USER_A.id}/[0-9a-f-]{36}$`));
    expect(body.url).toContain(body.key);
    expect(body.headers).toEqual({ 'content-type': 'video/mp4' });

    for (const payload of [
      { mime: 'video/mp4', bytes: 41 * MB },
      { mime: 'image/png', bytes: 3 * MB },
      { mime: 'image/gif', bytes: 100 },
    ]) {
      const res = await t.api({ method: 'POST', url: '/api/social/uploads', payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it('posts an uploaded video, moving it from uploads/ to posts/', async () => {
    const key = await upload('video/mp4', Buffer.from('a video'));
    const res = await t.api({
      method: 'POST',
      url: '/api/social/posts',
      payload: { sessionId: sessionA, upload: key, poster: JPEG },
    });
    expect(res.statusCode).toBe(201);
    const post = res.json().post;
    expect(post.media).toEqual({ mime: 'video/mp4', bytes: 7, poster: JPEG });

    const row = await t.db.query.postMedia.findFirst({ where: eq(postMedia.postId, post.id) });
    expect(row?.data).toBeNull();
    expect(row?.key).toMatch(new RegExp(`^posts/${USER_A.id}/[0-9a-f-]{36}\\.mp4$`));
    expect(r2.files.has(row!.key!)).toBe(true);
    expect(r2.files.has(key)).toBe(false);

    // The page plays it from a link; an old portal still gets the bytes.
    const link = await t.api({
      method: 'GET',
      url: `/api/posts/${post.id}/media/url`,
      token: t.tokenB,
    });
    expect(link.json()).toEqual({
      url: expect.stringMatching(/^data:video\/mp4;base64,/),
      expiresIn: 3600,
    });
    const bytes = await t.api({
      method: 'GET',
      url: `/api/posts/${post.id}/media`,
      token: t.tokenB,
    });
    expect(bytes.statusCode).toBe(200);
    expect(bytes.headers['content-type']).toBe('video/mp4');
    expect(bytes.rawPayload.toString()).toBe('a video');

    // Deleting the post deletes the file.
    const del = await t.api({ method: 'DELETE', url: `/api/posts/${post.id}` });
    expect(del.statusCode).toBe(204);
    expect(r2.files.has(row!.key!)).toBe(false);
  });

  it("refuses an upload that never arrived, someone else's, or one over the size", async () => {
    const missing = await t.api({
      method: 'POST',
      url: '/api/social/posts',
      payload: { sessionId: sessionA, upload: `uploads/${USER_A.id}/${crypto.randomUUID()}` },
    });
    expect(missing.statusCode).toBe(400);

    const theirs = await upload('video/mp4', Buffer.from('x'), t.tokenB);
    const stolen = await t.api({
      method: 'POST',
      url: '/api/social/posts',
      payload: { sessionId: sessionA, upload: theirs },
    });
    expect(stolen.statusCode).toBe(400);

    // The link signs the size, but check what landed anyway.
    const key = await upload('image/png', Buffer.from('p'));
    r2.put(key, 'image/png', Buffer.alloc(2 * MB + 1));
    const big = await t.api({
      method: 'POST',
      url: '/api/social/posts',
      payload: { sessionId: sessionA, upload: key },
    });
    expect(big.statusCode).toBe(400);

    const pic = await upload('image/png', Buffer.from('p'));
    const withPoster = await t.api({
      method: 'POST',
      url: '/api/social/posts',
      payload: { sessionId: sessionA, upload: pic, poster: JPEG },
    });
    expect(withPoster.statusCode).toBe(400);
  });

  it("keeps a friends-only post's file from people who aren't friends", async () => {
    await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      token: t.tokenB,
      payload: { social: { posts: 'friends' } },
    });
    const key = await upload('video/webm', Buffer.from('webm'), t.tokenB);
    const res = await t.api({
      method: 'POST',
      url: '/api/social/posts',
      token: t.tokenB,
      payload: { sessionId: sessionB, upload: key },
    });
    const id = res.json().post.id as string;
    const stranger = await t.api({ method: 'GET', url: `/api/posts/${id}/media/url` });
    expect(stranger.statusCode).toBe(404);
    const own = await t.api({ method: 'GET', url: `/api/posts/${id}/media/url`, token: t.tokenB });
    expect(own.statusCode).toBe(200);
  });

  it('deletes the files with the account', async () => {
    const key = await upload('video/mp4', Buffer.from('bye'));
    await t.api({
      method: 'POST',
      url: '/api/social/posts',
      payload: { sessionId: sessionA, upload: key },
    });
    const kept = [...r2.files.keys()].filter((k) => k.startsWith(`posts/${USER_A.id}/`));
    expect(kept.length).toBe(1);
    const res = await t.api({ method: 'DELETE', url: '/api/me' });
    expect(res.statusCode).toBe(204);
    expect([...r2.files.keys()].some((k) => k.startsWith(`posts/${USER_A.id}/`))).toBe(false);
  });
});

describe('post media without R2', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp('2026-09-23T14:00:00.000Z');
    await t.api({ method: 'GET', url: '/api/me' });
  });
  afterAll(() => t.close());

  it('keeps videos in Postgres, up to 5 MB, and gives no upload links', async () => {
    const limits = await t.api({ method: 'GET', url: '/api/social/uploads' });
    expect(limits.json()).toEqual({ direct: false, videoMaxBytes: 5 * MB, imageMaxBytes: 2 * MB });
    const link = await t.api({
      method: 'POST',
      url: '/api/social/uploads',
      payload: { mime: 'video/mp4', bytes: 100 },
    });
    expect(link.statusCode).toBe(409);
  });
});

describe('an admin deleting an account', () => {
  const r2 = memoryStore();
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp('2026-09-23T14:00:00.000Z', {
      mediaStore: r2.store,
      adminEmails: [USER_B.email],
    });
    for (const token of [t.tokenA, t.tokenB]) await t.api({ method: 'GET', url: '/api/me', token });
  });
  afterAll(() => t.close());

  it("deletes the account's files from R2 too", async () => {
    const [s] = await t.db
      .insert(sessions)
      .values(finished(USER_A.id, '2026-09-23T10:00:00Z', 3600))
      .returning();
    const link = await t.api({
      method: 'POST',
      url: '/api/social/uploads',
      payload: { mime: 'image/png', bytes: 3 },
    });
    const { key } = link.json() as { key: string };
    r2.put(key, 'image/png', Buffer.from('png'));
    const post = await t.api({
      method: 'POST',
      url: '/api/social/posts',
      payload: { sessionId: s!.id, upload: key },
    });
    expect(post.statusCode).toBe(201);
    expect([...r2.files.keys()].some((k) => k.startsWith(`posts/${USER_A.id}/`))).toBe(true);

    const res = await t.api({
      method: 'DELETE',
      url: `/api/admin/accounts/${USER_A.id}`,
      token: t.tokenB,
    });
    expect(res.statusCode).toBe(204);
    expect([...r2.files.keys()].some((k) => k.startsWith(`posts/${USER_A.id}/`))).toBe(false);
  });
});

describe('the R2 client', () => {
  const r2 = createR2Store({
    accountId: 'acct123',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    bucket: 'komodon-media',
  });
  afterEach(() => vi.unstubAllGlobals());

  it('signs an upload link that takes only that type and size', async () => {
    const url = new URL(await r2.uploadUrl('uploads/u/abc', 'video/mp4', 1234, 900));
    expect(url.origin).toBe('https://acct123.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/komodon-media/uploads/u/abc');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(
      /^AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request$/,
    );
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signs a read link with the host only', async () => {
    const url = new URL(await r2.readUrl('posts/u/abc.mp4', 3600));
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
  });

  it('heads, copies and deletes with signed requests', async () => {
    const seen: Request[] = [];
    vi.stubGlobal('fetch', async (input: Request) => {
      seen.push(input);
      if (input.method === 'HEAD')
        return new Response(null, {
          status: 200,
          headers: { 'content-length': '42', 'content-type': 'video/mp4' },
        });
      if (input.method === 'DELETE') return new Response(null, { status: 404 });
      return new Response('<CopyObjectResult/>', { status: 200 });
    });
    expect(await r2.head('posts/u/a.mp4')).toEqual({ bytes: 42, mime: 'video/mp4' });
    await r2.copy('uploads/u/a', 'posts/u/a.mp4');
    await r2.remove('posts/u/gone.mp4');
    expect(seen.map((r) => r.method)).toEqual(['HEAD', 'PUT', 'DELETE']);
    expect(seen[1]!.url).toBe(
      'https://acct123.r2.cloudflarestorage.com/komodon-media/posts/u/a.mp4',
    );
    expect(seen[1]!.headers.get('x-amz-copy-source')).toBe('/komodon-media/uploads/u/a');
    for (const r of seen) expect(r.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it('says nothing is there on a 404', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }));
    expect(await r2.head('nope')).toBeNull();
  });
});
