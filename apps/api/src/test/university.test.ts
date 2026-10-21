import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHsVerifier, signDevToken } from '../auth/verify';
import { createPgliteDb } from '../db/client';
import { buildServer } from '../server';
import type { Mail } from '../services/mail';
import { TEST_SECRET, USER_A, USER_B, type TestApp } from './helpers';

let t: TestApp;
const sent: Mail[] = [];
let mailDown = false;
const lastCode = () => sent[sent.length - 1]!.subject.match(/^(\d{6}) /)![1]!;

beforeAll(async () => {
  const { db, close } = await createPgliteDb();
  const clock = { now: '2026-09-21T14:00:00.000Z' };
  const app = await buildServer({
    db,
    verifier: createHsVerifier(TEST_SECRET),
    clock: () => clock.now,
    mailer: {
      send: async (m) => {
        if (mailDown) throw new Error('mail is down');
        sent.push(m);
      },
    },
  });
  await app.ready();
  const tokenA = await signDevToken(TEST_SECRET, USER_A);
  const tokenB = await signDevToken(TEST_SECRET, USER_B);
  t = {
    app,
    db,
    clock,
    tokenA,
    tokenB,
    api: ({ token = tokenA, tz = 'America/Toronto', headers, ...rest }) =>
      app.inject({
        ...rest,
        headers: { authorization: `Bearer ${token}`, 'x-timezone': tz, ...(headers as object) },
      }),
    close: async () => {
      await app.close();
      await close();
    },
  };
  for (const token of [tokenA, tokenB]) {
    await t.api({ method: 'GET', url: '/api/me', token });
    await t.api({ method: 'PATCH', url: '/api/me', token, payload: { onboarded: true } });
  }
});
afterAll(() => t.close());

const tick = (ms: number) => {
  t.clock.now = new Date(Date.parse(t.clock.now) + ms).toISOString();
};

describe('university verification', () => {
  it('cannot be set through settings', async () => {
    const res = await t.api({
      method: 'PATCH',
      url: '/api/me/settings',
      payload: { profile: { university: 'toronto' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses an address that is not from a known university', async () => {
    const res = await t.api({
      method: 'POST',
      url: '/api/me/university/send',
      payload: { email: 'ada@gmail.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it('sends a code to a university address and puts the university on the profile once it comes back', async () => {
    const send = await t.api({
      method: 'POST',
      url: '/api/me/university/send',
      payload: { email: 'Ada.L@Mail.UToronto.ca' },
    });
    expect(send.statusCode).toBe(200);
    expect(send.json()).toMatchObject({
      university: { id: 'toronto', name: 'University of Toronto' },
      email: 'ada.l@mail.utoronto.ca',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('ada.l@mail.utoronto.ca');
    expect(sent[0]!.text).toContain(lastCode());

    // Nothing on the profile yet.
    let prof = (await t.api({ method: 'GET', url: '/api/profiles/me' })).json();
    expect(prof.profile.university).toBeNull();
    const status = (await t.api({ method: 'GET', url: '/api/me/university' })).json();
    expect(status.university).toBeNull();
    expect(status.pending).toMatchObject({ email: 'ada.l@mail.utoronto.ca' });

    const wrong = await t.api({
      method: 'POST',
      url: '/api/me/university/confirm',
      payload: { code: lastCode() === '000000' ? '000001' : '000000' },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toContain('4 tries left');

    const right = await t.api({
      method: 'POST',
      url: '/api/me/university/confirm',
      payload: { code: lastCode() },
    });
    expect(right.statusCode).toBe(200);
    expect(right.json().university.id).toBe('toronto');

    prof = (await t.api({ method: 'GET', url: '/api/profiles/me' })).json();
    expect(prof.profile.university).toMatchObject({ id: 'toronto' });
    // The address stays private: the owner's status has it, the profile does not.
    expect(JSON.stringify(prof)).not.toContain('utoronto');
    const after = (await t.api({ method: 'GET', url: '/api/me/university' })).json();
    expect(after).toMatchObject({
      university: { id: 'toronto' },
      email: 'ada.l@mail.utoronto.ca',
      pending: null,
    });

    // A used code is gone.
    const again = await t.api({
      method: 'POST',
      url: '/api/me/university/confirm',
      payload: { code: lastCode() },
    });
    expect(again.statusCode).toBe(400);
  });

  it('waits a minute between codes, and a code expires after 15 minutes', async () => {
    const soon = await t.api({
      method: 'POST',
      url: '/api/me/university/send',
      token: t.tokenB,
      payload: { email: 'ben@uwaterloo.ca' },
    });
    expect(soon.statusCode).toBe(200);
    const tooSoon = await t.api({
      method: 'POST',
      url: '/api/me/university/send',
      token: t.tokenB,
      payload: { email: 'ben@uwaterloo.ca' },
    });
    expect(tooSoon.statusCode).toBe(400);
    tick(16 * 60_000);
    const late = await t.api({
      method: 'POST',
      url: '/api/me/university/confirm',
      token: t.tokenB,
      payload: { code: lastCode() },
    });
    expect(late.statusCode).toBe(400);
    expect(late.json().error).toContain('expired');
  });

  it('lets one address verify only one account', async () => {
    tick(60_000);
    // Ada is verified with U of T from above; a verified address is never replaced in place.
    await t.api({ method: 'DELETE', url: '/api/me/university' });
    await t.api({
      method: 'POST',
      url: '/api/me/university/send',
      payload: { email: 'shared@queensu.ca' },
    });
    await t.api({
      method: 'POST',
      url: '/api/me/university/confirm',
      payload: { code: lastCode() },
    });
    const other = await t.api({
      method: 'POST',
      url: '/api/me/university/send',
      token: t.tokenB,
      payload: { email: 'Shared@QueensU.ca' },
    });
    expect(other.statusCode).toBe(400);
    expect(other.json().error).toContain('already on another account');
  });

  it('keeps a verified address until it is removed', async () => {
    tick(60_000);
    const res = await t.api({
      method: 'POST',
      url: '/api/me/university/send',
      payload: { email: 'ada@uwaterloo.ca' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Remove it first');
    const status = (await t.api({ method: 'GET', url: '/api/me/university' })).json();
    expect(status).toMatchObject({ university: { id: 'queens' }, email: 'shared@queensu.ca' });
  });

  it('records nothing when the mail cannot be sent, so the next try is not blocked', async () => {
    tick(60_000);
    mailDown = true;
    const down = await t.api({
      method: 'POST',
      url: '/api/me/university/send',
      token: t.tokenB,
      payload: { email: 'ben@uottawa.ca' },
    });
    expect(down.statusCode).toBe(502);
    mailDown = false;
    const retry = await t.api({
      method: 'POST',
      url: '/api/me/university/send',
      token: t.tokenB,
      payload: { email: 'ben@uottawa.ca' },
    });
    expect(retry.statusCode).toBe(200);
  });

  it('a settings change landing beside confirm is not lost', async () => {
    // Ben confirms the uOttawa code while a bio PATCH goes through: both must land.
    const [patch, confirm] = await Promise.all([
      t.api({
        method: 'PATCH',
        url: '/api/me/settings',
        token: t.tokenB,
        payload: { profile: { bio: 'Kept.' } },
      }),
      t.api({
        method: 'POST',
        url: '/api/me/university/confirm',
        token: t.tokenB,
        payload: { code: lastCode() },
      }),
    ]);
    expect(patch.statusCode).toBe(200);
    expect(confirm.statusCode).toBe(200);
    const me = (await t.api({ method: 'GET', url: '/api/me', token: t.tokenB })).json();
    expect(me.user.settings.profile).toMatchObject({ bio: 'Kept.', university: 'ottawa' });
  });

  it('removes the university and forgets the address', async () => {
    const res = await t.api({ method: 'DELETE', url: '/api/me/university' });
    expect(res.statusCode).toBe(204);
    const prof = (await t.api({ method: 'GET', url: '/api/profiles/me' })).json();
    expect(prof.profile.university).toBeNull();
    const status = (await t.api({ method: 'GET', url: '/api/me/university' })).json();
    expect(status).toEqual({ university: null, email: null, pending: null });
  });
});
