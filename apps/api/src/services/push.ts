import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';
import { personName, withDefaults, type UserSettings } from '@komogon/core';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { pushSubscriptions, users, type UserRow } from '../db/schema';
import { settingsOf } from './users';

/**
 * Browser notifications for the bell's kinds (Web Push: RFC 8030, with VAPID, RFC 8292, and
 * the aes128gcm encryption of RFC 8291), written on Node's crypto rather than a package.
 *
 * The VAPID keys come from the API's own secret, so there is nothing to set up on Render: the
 * same secret gives the same keys after every restart. A new secret gives new keys; browsers
 * still holding a subscription made with the old one get a new one on their next visit (the
 * portal compares keys, lib/push.ts).
 */

export type PushKind = 'nudge' | 'kudos' | 'comment' | 'mention';

/** What the service worker shows (public/push-sw.js). */
export interface PushMessage {
  kind: PushKind;
  title: string;
  body: string;
  /** Where a click goes, in the app. */
  url: string;
  /** The bell's id for the same thing, so a repeat replaces it rather than stacking up. */
  tag: string;
}

const nameOf = (row: UserRow) => personName(settingsOf(row).profile.name, row.username);

const clip = (text: string, max: number) => {
  const flat = text.trim().replace(/\s+/g, ' ');
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
};

const fmtMinutes = (m: number) => {
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h === 0 ? `${r} min` : r === 0 ? `${h} h` : `${h} h ${r} min`;
};

/**
 * Each kind's words and where a click goes, the same as the bell's line for it
 * (Notifications.tsx): the bell's id is the tag, and its link is the url.
 */
export const pushMessages = {
  kudos: (
    from: UserRow,
    post: { id: string; subject: string | null; body: string; minutes: number | null },
  ): PushMessage => ({
    kind: 'kudos',
    title: `${nameOf(from)} gave you kudos`,
    body:
      post.subject ??
      (post.body.trim()
        ? clip(post.body, 40)
        : post.minutes !== null
          ? `${fmtMinutes(post.minutes)} of focus`
          : 'Your post'),
    url: `/profile#post-${post.id}`,
    tag: `kudos:${post.id}:${from.id}`,
  }),
  comment: (from: UserRow, comment: { id: string; postId: string; body: string }): PushMessage => ({
    kind: 'comment',
    title: `${nameOf(from)} commented`,
    body: clip(comment.body, 140),
    url: `/profile#post-${comment.postId}-comments`,
    tag: `comment:${comment.id}`,
  }),
  mention: (
    from: UserRow,
    comment: { id: string; postId: string; body: string },
    postOwnerId: string,
  ): PushMessage => ({
    kind: 'mention',
    title: `${nameOf(from)} mentioned you`,
    body: clip(comment.body, 140),
    url: `/profile/${postOwnerId}#post-${comment.postId}-comments`,
    tag: `mention:${comment.id}`,
  }),
  nudge: (from: UserRow, nudgeId: string, groupName: string | null): PushMessage => ({
    kind: 'nudge',
    title: `${nameOf(from)} nudged you`,
    body: groupName ?? '',
    url: `/profile/${from.id}`,
    tag: `nudge:${nudgeId}`,
  }),
};

/** Each kind's switch in Settings › Notifications. */
const SETTING: Record<PushKind, keyof UserSettings['notifications']> = {
  nudge: 'nudges',
  kudos: 'kudos',
  comment: 'comments',
  mention: 'mentions',
};

/** How long a push service keeps trying: a nudge is about now, the rest can wait a day. */
const TTL_SECONDS: Record<PushKind, number> = {
  nudge: 2 * 60 * 60,
  kudos: 24 * 60 * 60,
  comment: 24 * 60 * 60,
  mention: 24 * 60 * 60,
};

/**
 * The browsers' push services. A subscription names the address the API posts to, so only
 * these are taken: anything else would let someone point the API at any server they like.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /\.notify\.windows\.com$/,
];

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.port && PUSH_HOSTS.some((h) => h.test(url.hostname));
  } catch {
    return false;
  }
}

const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

/** The order of P-256: a private key is a number from 1 below it. */
const P256_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

export interface VapidKeys {
  /** The uncompressed public key, base64url: what browsers subscribe with. */
  publicKey: string;
  key: KeyObject;
}

export function vapidKeysFrom(secret: string): VapidKeys {
  for (let i = 0; ; i++) {
    const d = Buffer.from(hkdfSync('sha256', secret, 'komodon-vapid', `p-256 ${i}`, 32));
    const n = BigInt(`0x${d.toString('hex')}`);
    if (n === 0n || n >= P256_N) continue;
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(d);
    const pub = ecdh.getPublicKey();
    const key = createPrivateKey({
      format: 'jwk',
      key: {
        kty: 'EC',
        crv: 'P-256',
        d: b64u(d),
        x: b64u(pub.subarray(1, 33)),
        y: b64u(pub.subarray(33, 65)),
      },
    });
    return { publicKey: b64u(pub), key };
  }
}

/** The Authorization header for one push service: a signed note saying who is sending. */
export function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  nowSeconds: number,
): string {
  const part = (o: object) => b64u(Buffer.from(JSON.stringify(o)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({
    aud: new URL(endpoint).origin,
    exp: nowSeconds + 12 * 60 * 60,
    sub: subject,
  })}`;
  const signature = sign('sha256', Buffer.from(unsigned), {
    key: keys.key,
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${unsigned}.${b64u(signature)}, k=${keys.publicKey}`;
}

/**
 * The message encrypted for one browser, as a single aes128gcm record (RFC 8291). `fixed`
 * is for the RFC's worked example; real sends get a fresh key and salt each time.
 */
export function encryptForBrowser(
  plaintext: Buffer,
  browserKey: Buffer,
  authSecret: Buffer,
  fixed?: { privateKey: Buffer; salt: Buffer },
): Buffer {
  const ecdh = createECDH('prime256v1');
  if (fixed) ecdh.setPrivateKey(fixed.privateKey);
  else ecdh.generateKeys();
  const serverKey = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(browserKey);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), browserKey, serverKey]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const salt = fixed?.salt ?? randomBytes(16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // 2 marks the last (and only) record.
  const sealed = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(serverKey.length, 20);
  return Buffer.concat([header, serverKey, sealed]);
}

export interface Push {
  /** For the portal to subscribe with (`GET /api/push/key`). */
  publicKey: string;
  /**
   * Tells every browser this person turned notifications on in, if they want this kind.
   * Runs after the request has answered and never throws.
   */
  notify: (toId: string, message: PushMessage) => void;
  /** Every send still going; tests wait on it. */
  idle: () => Promise<void>;
}

declare module 'fastify' {
  interface FastifyInstance {
    push: Push;
  }
}

export function createPush(opts: {
  db: Db;
  secret: string;
  /** Who is sending, for the push services: a mailto: or https: address. */
  subject?: string;
  fetch?: typeof fetch;
  clock: () => string;
  warn?: (msg: string) => void;
}): Push {
  const keys = vapidKeysFrom(opts.secret);
  const send = opts.fetch ?? fetch;
  const subject = opts.subject ?? 'https://komogon.app';
  const warn = opts.warn ?? (() => undefined);
  const running = new Set<Promise<void>>();

  const deliver = async (toId: string, message: PushMessage) => {
    const user = await opts.db.query.users.findFirst({
      where: eq(users.id, toId),
      columns: { settings: true, bannedAt: true },
    });
    if (!user || user.bannedAt) return;
    if (!withDefaults(user.settings).notifications[SETTING[message.kind]]) return;
    const subs = await opts.db.query.pushSubscriptions.findMany({
      where: eq(pushSubscriptions.userId, toId),
    });
    if (subs.length === 0) return;
    const now = Math.floor(Date.parse(opts.clock()) / 1000);
    const plaintext = Buffer.from(JSON.stringify(message));
    await Promise.all(
      subs.map(async (sub) => {
        try {
          const res = await send(sub.endpoint, {
            method: 'POST',
            headers: {
              authorization: vapidAuthorization(sub.endpoint, keys, subject, now),
              'content-encoding': 'aes128gcm',
              'content-type': 'application/octet-stream',
              ttl: String(TTL_SECONDS[message.kind]),
              urgency: message.kind === 'nudge' ? 'high' : 'normal',
            },
            body: encryptForBrowser(
              plaintext,
              Buffer.from(sub.p256dh, 'base64url'),
              Buffer.from(sub.auth, 'base64url'),
            ),
          });
          // Gone: the browser unsubscribed, or its permission was taken back.
          if (res.status === 404 || res.status === 410) {
            await opts.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
          } else if (!res.ok) {
            warn(`[push] ${new URL(sub.endpoint).hostname} answered ${res.status}`);
          }
        } catch (err) {
          warn(`[push] ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    );
  };

  return {
    publicKey: keys.publicKey,
    notify: (toId, message) => {
      const job = deliver(toId, message).catch((err: unknown) =>
        warn(`[push] ${err instanceof Error ? err.message : String(err)}`),
      );
      running.add(job);
      void job.finally(() => running.delete(job));
    },
    idle: async () => {
      await Promise.all([...running]);
    },
  };
}
