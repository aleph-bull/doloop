import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The OAuth `state` parameter, signed so the callback can trust who started the flow.
 * Shared by every consent flow (Google Calendar, Spotify): the payload is whatever the
 * caller needs back, the timestamp bounds how long the link stays valid.
 */

const MAX_AGE_MS = 15 * 60_000;

export function signState(payload: string, secret: string): string {
  const body = Buffer.from(payload, 'utf8').toString('base64url');
  const ts = Date.now().toString(36);
  const sig = createHmac('sha256', secret).update(`${body}.${ts}`).digest('base64url');
  return `${body}.${ts}.${sig}`;
}

/** The payload the state was signed with, or null when it is forged, malformed or stale. */
export function verifyState(state: string, secret: string): string | null {
  const [body, ts, sig] = state.split('.');
  if (!body || !ts || !sig) return null;
  const expect = createHmac('sha256', secret).update(`${body}.${ts}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Date.now() - parseInt(ts, 36) > MAX_AGE_MS) return null;
  return Buffer.from(body, 'base64url').toString('utf8');
}
