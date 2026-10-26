import {
  createDecipheriv,
  createECDH,
  createPublicKey,
  hkdfSync,
  randomBytes,
  verify,
  type ECDH,
} from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TimerState } from '@komogon/core';
import { eq } from 'drizzle-orm';
import { signDevToken } from '../auth/verify';
import { nodes, pushSubscriptions, sessions, users } from '../db/schema';
import { encryptForBrowser, vapidAuthorization, vapidKeysFrom } from '../services/push';
import { advanceClock, createTestApp, TEST_SECRET, USER_A, USER_B, type TestApp } from './helpers';

const USER_C = { id: '33333333-3333-4333-8333-333333333333', email: 'c@example.com' };

/** A browser's side of a subscription: its keys, and reading what is sent to it. */
function fakeBrowser(endpoint: string) {
  const ecdh: ECDH = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    endpoint,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: auth.toString('base64url'),
    },
    read(body: Buffer) {
      const salt = body.subarray(0, 16);
      const idLength = body.readUInt8(20);
      const serverKey = body.subarray(21, 21 + idLength);
      const sealed = body.subarray(21 + idLength);
      const shared = ecdh.computeSecret(serverKey);
      const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), serverKey]);
      const ikm = Buffer.from(hkdfSync('sha256', shared, auth, info, 32));
      const cek = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16));
      const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12));
      const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
      decipher.setAuthTag(sealed.subarray(sealed.length - 16));
      const plain = Buffer.concat([
        decipher.update(sealed.subarray(0, sealed.length - 16)),
        decipher.final(),
      ]);
      expect(plain[plain.length - 1]).toBe(2);
      return JSON.parse(plain.subarray(0, -1).toString('utf8'));
    },
  };
}

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Buffer;
}

let t: TestApp;
let tokenC: string;
const sent: Sent[] = [];
let answer = 201;

beforeAll(async () => {
  t = await createTestApp('2026-09-23T14:00:00.000Z', {
    pushFetch: (async (url: string, init: RequestInit) => {
      sent.push({
        url,
        headers: init.headers as Record<string, string>,
        body: Buffer.from(init.body as Uint8Array),
      });
      return new Response(null, { status: answer });
    }) as unknown as typeof fetch,
  });
  tokenC = await signDevToken(TEST_SECRET, USER_C);
  for (const token of [t.tokenA, t.tokenB, tokenC]) {
    await t.api({ method: 'GET', url: '/api/me', token });
    await t.api({ method: 'PATCH', url: '/api/me', token, payload: { onboarded: true } });
  }
  await t.api({ method: 'PATCH', url: '/api/me/settings', payload: { profile: { name: 'Ada' } } });
  await t.db.update(users).set({ username: 'cleo' }).where(eq(users.id, USER_C.id));
  const ask = (
    await t.api({
      method: 'POST',
      url: '/api/social/friends/requests',
      payload: { userId: USER_B.id },
    })
  ).json();
  await t.api({
    method: 'POST',
    url: `/api/social/friends/requests/${ask.friendship.requestId}/accept`,
    token: t.tokenB,
  });
});
afterAll(() => t.close());

const settle = async () => {
  await t.app.push.idle();
  return sent.splice(0);
};

describe('Web Push pieces', () => {
  it('encrypts as in the worked example of RFC 8291', () => {
    const b = (s: string) => Buffer.from(s, 'base64url');
    const out = encryptForBrowser(
      Buffer.from('When I grow up, I want to be a watermelon'),
      b('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'),
      b('BTBZMqHH6r4Tts7J_aSIgg'),
      {
        privateKey: b('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
        salt: b('DGv6ra1nlYgDCS1FRnbzlw'),
      },
    );
    expect(out.toString('base64url')).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });

  it('keeps the same keys for the same secret, and signs for the push service', () => {
    const keys = vapidKeysFrom('some secret');
    expect(vapidKeysFrom('some secret').publicKey).toBe(keys.publicKey);
    expect(vapidKeysFrom('another').publicKey).not.toBe(keys.publicKey);
    const pub = Buffer.from(keys.publicKey, 'base64url');
    expect(pub).toHaveLength(65);

    const header = vapidAuthorization(
      'https://fcm.googleapis.com/fcm/send/x',
      keys,
      'https://komogon.app',
      1000,
    );
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, s] = jwt!.split('.');
    expect(JSON.parse(Buffer.from(c!, 'base64url').toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: 1000 + 12 * 60 * 60,
      sub: 'https://komogon.app',
    });
    const key = createPublicKey({
      format: 'jwk',
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: pub.subarray(1, 33).toString('base64url'),
        y: pub.subarray(33).toString('base64url'),
      },
    });
    expect(
      verify(
        'sha256',
        Buffer.from(`${h}.${c}`),
        { key, dsaEncoding: 'ieee-p1363' },
        Buffer.from(s!, 'base64url'),
      ),
    ).toBe(true);
  });
});

describe('browser notifications', () => {
  const ben = fakeBrowser('https://fcm.googleapis.com/fcm/send/ben-laptop');
  const cleo = fakeBrowser('https://updates.push.services.mozilla.com/wpush/v2/cleo');
  let postId: string;

  it('hands out the key and takes only real push services', async () => {
    const key = (await t.api({ method: 'GET', url: '/api/push/key' })).json().key;
    expect(Buffer.from(key, 'base64url')).toHaveLength(65);

    for (const endpoint of [
      'http://fcm.googleapis.com/fcm/send/x',
      'https://localhost/x',
      'https://169.254.169.254/latest',
      'https://evil.example/fcm.googleapis.com',
      'https://fcm.googleapis.com.evil.example/x',
    ]) {
      const res = await t.api({
        method: 'PUT',
        url: '/api/push/subscription',
        token: t.tokenB,
        payload: { endpoint, keys: ben.keys },
      });
      expect(res.statusCode, endpoint).toBe(400);
    }
    const bad = await t.api({
      method: 'PUT',
      url: '/api/push/subscription',
      token: t.tokenB,
      payload: { endpoint: ben.endpoint, keys: { p256dh: 'abc', auth: ben.keys.auth } },
    });
    expect(bad.statusCode).toBe(400);

    for (const [sub, token] of [
      [ben, t.tokenB],
      [cleo, tokenC],
    ] as const) {
      const res = await t.api({
        method: 'PUT',
        url: '/api/push/subscription',
        token,
        payload: sub,
      });
      expect(res.statusCode).toBe(204);
    }
    // Again from the same browser: still one row.
    await t.api({ method: 'PUT', url: '/api/push/subscription', token: t.tokenB, payload: ben });
    const rows = await t.db.query.pushSubscriptions.findMany({
      where: eq(pushSubscriptions.userId, USER_B.id),
    });
    expect(rows).toHaveLength(1);
  });

  it('sends kudos, comments, mentions and nudges, encrypted for each browser', async () => {
    const [course] = await t.db
      .insert(nodes)
      .values({ userId: USER_B.id, title: 'Physics', kind: 'course' })
      .returning();
    const [s] = await t.db
      .insert(sessions)
      .values({
        userId: USER_B.id,
        nodeId: course!.id,
        startedAt: new Date('2026-09-23T12:00:00Z'),
        endedAt: new Date('2026-09-23T13:00:00Z'),
        mode: 'unlimited',
        workSeconds: 3600,
        timer: {} as TimerState,
      })
      .returning();
    postId = (
      await t.api({
        method: 'POST',
        url: '/api/social/posts',
        token: t.tokenB,
        payload: { body: 'Long one', sessionId: s!.id },
      })
    ).json().post.id;

    // Your own kudos on your own post isn't news.
    await t.api({ method: 'POST', url: `/api/posts/${postId}/like`, token: t.tokenB });
    expect(await settle()).toEqual([]);

    await t.api({ method: 'POST', url: `/api/posts/${postId}/like` });
    let out = await settle();
    expect(out).toHaveLength(1);
    expect(out[0]!.url).toBe(ben.endpoint);
    expect(out[0]!.headers).toMatchObject({
      'content-encoding': 'aes128gcm',
      urgency: 'normal',
      ttl: String(24 * 60 * 60),
    });
    expect(out[0]!.headers.authorization).toMatch(/^vapid t=.+, k=.+$/);
    expect(ben.read(out[0]!.body)).toEqual({
      kind: 'kudos',
      title: 'Ada gave you kudos',
      body: 'Physics',
      url: `/profile#post-${postId}`,
      tag: `kudos:${postId}:${USER_A.id}`,
    });

    // Already given: nothing new.
    await t.api({ method: 'POST', url: `/api/posts/${postId}/like` });
    expect(await settle()).toEqual([]);

    advanceClock(t, 1);
    await t.api({
      method: 'POST',
      url: `/api/posts/${postId}/comments`,
      payload: { body: 'Nice one @cleo' },
    });
    out = await settle();
    expect(out.map((o) => o.url).sort()).toEqual([cleo.endpoint, ben.endpoint].sort());
    const toBen = out.find((o) => o.url === ben.endpoint)!;
    const toCleo = out.find((o) => o.url === cleo.endpoint)!;
    expect(ben.read(toBen.body)).toMatchObject({
      kind: 'comment',
      title: 'Ada commented',
      body: 'Nice one @cleo',
      url: `/profile#post-${postId}-comments`,
    });
    expect(cleo.read(toCleo.body)).toMatchObject({
      kind: 'mention',
      title: 'Ada mentioned you',
      url: `/profile/${USER_B.id}#post-${postId}-comments`,
    });

    await t.api({ method: 'POST', url: '/api/social/nudges', payload: { userId: USER_B.id } });
    out = await settle();
    expect(out).toHaveLength(1);
    expect(out[0]!.headers).toMatchObject({ urgency: 'high', ttl: String(2 * 60 * 60) });
    expect(ben.read(out[0]!.body)).toMatchObject({
      kind: 'nudge',
      title: 'Ada nudged you',
      url: `/profile/${USER_A.id}`,
    });
  });

  it('leaves out the kinds turned off in Settings', async () => {
    await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      token: t.tokenB,
      payload: { notifications: { kudos: false, comments: false } },
    });
    await t.api({ method: 'DELETE', url: `/api/posts/${postId}/like` });
    await t.api({ method: 'POST', url: `/api/posts/${postId}/like` });
    await t.api({
      method: 'POST',
      url: `/api/posts/${postId}/comments`,
      payload: { body: 'Quiet one' },
    });
    expect(await settle()).toEqual([]);
    await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      token: t.tokenB,
      payload: { notifications: { kudos: true, comments: true } },
    });
  });

  it('moves a browser to whoever signs in there, and forgets one that is gone', async () => {
    // Cleo signs in on Ben's laptop: it is hers now.
    await t.api({ method: 'PUT', url: '/api/push/subscription', token: tokenC, payload: ben });
    advanceClock(t, 1);
    await t.api({
      method: 'POST',
      url: `/api/posts/${postId}/comments`,
      payload: { body: 'Hello' },
    });
    expect(await settle()).toEqual([]);
    await t.api({ method: 'PUT', url: '/api/push/subscription', token: t.tokenB, payload: ben });

    // Someone else can't take a browser off.
    await t.api({
      method: 'DELETE',
      url: '/api/push/subscription',
      token: tokenC,
      payload: { endpoint: ben.endpoint },
    });
    expect(
      await t.db.query.pushSubscriptions.findFirst({
        where: eq(pushSubscriptions.endpoint, ben.endpoint),
      }),
    ).toMatchObject({ userId: USER_B.id });

    // The push service says the browser has unsubscribed.
    answer = 410;
    advanceClock(t, 1);
    await t.api({
      method: 'POST',
      url: `/api/posts/${postId}/comments`,
      payload: { body: 'Still there?' },
    });
    expect(await settle()).toHaveLength(1);
    answer = 201;
    expect(
      await t.db.query.pushSubscriptions.findFirst({
        where: eq(pushSubscriptions.endpoint, ben.endpoint),
      }),
    ).toBeUndefined();

    // Turning it off in Cleo's browser.
    const off = await t.api({
      method: 'DELETE',
      url: '/api/push/subscription',
      token: tokenC,
      payload: { endpoint: cleo.endpoint },
    });
    expect(off.statusCode).toBe(204);
    expect(await t.db.query.pushSubscriptions.findMany()).toEqual([]);
  });

  it('sends nothing to a suspended account', async () => {
    await t.api({ method: 'PUT', url: '/api/push/subscription', token: t.tokenB, payload: ben });
    await t.db.update(users).set({ bannedAt: new Date() }).where(eq(users.id, USER_B.id));
    await t.api({ method: 'DELETE', url: `/api/posts/${postId}/like` });
    await t.api({ method: 'POST', url: `/api/posts/${postId}/like` });
    expect(await settle()).toEqual([]);
    await t.db.update(users).set({ bannedAt: null }).where(eq(users.id, USER_B.id));
  });
});
