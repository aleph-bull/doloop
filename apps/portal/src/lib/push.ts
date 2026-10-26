import { api } from './api';

/**
 * Browser notifications in this browser: nudges, kudos, comments and mentions, sent by the
 * API (services/push.ts) and shown by public/push-sw.js, even with no tab open.
 *
 * Whether a browser gets them is that browser's own choice: on when it holds a push
 * subscription, off when it doesn't. Which kinds are sent is a setting on the account
 * (`settings.notifications`), the same everywhere.
 */

const WORKER = '/push-sw.js';
const SCOPE = '/push/';
/** Whose subscription this browser holds, so the next person to sign in here doesn't get it. */
const OWNER_KEY = 'komogon.push.user';

export type PushState =
  /** No notifications in this browser at all. */
  | 'unsupported'
  /** Safari on an iPhone or iPad: only once Komodon is on the Home Screen. */
  | 'home-screen'
  /** Turned down in the browser; only its site settings can bring them back. */
  | 'denied'
  | 'off'
  | 'on';

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function onIosBrowser(): boolean {
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && !window.matchMedia('(display-mode: standalone)').matches;
}

function readOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

function writeOwner(userId: string | null) {
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId);
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    /* blocked storage: the subscription still works */
  }
}

function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const b64 = key.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const had = sub.options.applicationServerKey;
  if (!had) return false;
  const bytes = new Uint8Array(had);
  return bytes.length === key.length && bytes.every((b, i) => b === key[i]);
}

/** The worker's registration (not the caching worker's, whose scope also covers /push/). */
async function existingRegistration(): Promise<ServiceWorkerRegistration | null> {
  const reg = await navigator.serviceWorker.getRegistration(SCOPE);
  return reg && new URL(reg.scope).pathname === SCOPE ? reg : null;
}

/** Registers the worker (or checks it for a new version) and waits until it is running. */
async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register(WORKER, { scope: SCOPE });
  const worker = reg.installing ?? reg.waiting;
  if (!reg.active && worker) {
    await new Promise<void>((resolve) => {
      const check = () => {
        if (worker.state === 'activated' || worker.state === 'redundant') resolve();
      };
      worker.addEventListener('statechange', check);
      check();
    });
  }
  return reg;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await existingRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return onIosBrowser() ? 'home-screen' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  return (await currentSubscription()) ? 'on' : 'off';
}

/** Subscribes with the API's current key (a new one if the key changed) and tells the API. */
async function subscribe(userId: string): Promise<void> {
  const [{ key }, reg] = await Promise.all([api.pushKey(), activeRegistration()]);
  const bytes = keyBytes(key);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, bytes)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  await api.pushSubscribe(sub.toJSON());
  writeOwner(userId);
}

/**
 * Turns them on in this browser. Call it straight from a click: the browser asks only for
 * one, and its question comes first.
 */
export async function turnOnPush(userId: string): Promise<PushState> {
  if (!pushSupported()) return pushState();
  const permission =
    Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'off';
  await subscribe(userId);
  return 'on';
}

/**
 * At sign-out: the API stops sending here, so the next person on this browser doesn't get
 * yours. The browser keeps the subscription, and it is used again only if you sign back in.
 */
export async function pausePushForSignOut(): Promise<void> {
  if (!pushSupported()) return;
  const sub = await currentSubscription();
  if (sub) await api.pushUnsubscribe(sub.endpoint);
}

/** Turns them off in this browser. */
export async function turnOffPush(): Promise<void> {
  if (!pushSupported()) return;
  const sub = await currentSubscription();
  writeOwner(null);
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

/**
 * On each visit: keeps this browser's subscription and the API in step (a new worker, a new
 * key, a row the API dropped, signing back in). One left by someone else who signed in here
 * goes.
 */
export async function syncPush(userId: string): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const sub = await currentSubscription();
  if (!sub) return;
  if (readOwner() !== userId) {
    writeOwner(null);
    await sub.unsubscribe().catch(() => undefined);
    return;
  }
  await subscribe(userId);
}
