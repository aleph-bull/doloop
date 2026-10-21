import { afterEach, expect, it, vi } from 'vitest';
import { createGoogleClient } from '../services/google';
import { createOutlookClient, OutlookRevokedError } from '../services/outlook';

afterEach(() => vi.unstubAllGlobals());
const google = () =>
  createGoogleClient({
    clientId: 'id',
    clientSecret: 'secret',
    redirectUri: 'http://localhost/callback',
  });
const outlook = () =>
  createOutlookClient({
    clientId: 'id',
    clientSecret: 'secret',
    redirectUri: 'http://localhost/callback',
    tenant: 'common',
  });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

it('reads every Google calendar page and expands recurring events within the import window', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      json({ items: [{ id: 'school', summary: 'School' }], nextPageToken: 'next' }),
    )
    .mockResolvedValueOnce(json({ items: [{ id: 'primary', summary: 'Personal' }] }))
    .mockResolvedValueOnce(json({ items: [{ id: 'lecture-1' }], nextPageToken: 'page2' }))
    .mockResolvedValueOnce(json({ items: [{ id: 'lecture-2' }] }));
  vi.stubGlobal('fetch', fetcher);
  expect(await google().listCalendars('at')).toHaveLength(2);
  expect(
    (
      await google().listEvents('at', 'school', {
        timeMin: '2026-10-01T00:00:00Z',
        timeMax: '2027-04-01T00:00:00Z',
      })
    ).items,
  ).toHaveLength(2);
  const query = new URL(fetcher.mock.calls[3]![0]).searchParams;
  expect(query.get('singleEvents')).toBe('true');
  expect(query.get('timeMax')).toBe('2027-04-01T00:00:00Z');
  expect(query.get('pageToken')).toBe('page2');
});

it('uses Outlook read-only OAuth with offline access and PKCE', async () => {
  const client = outlook();
  const url = new URL(client.authUrl('state', 'challenge'));
  expect(url.searchParams.get('scope')).toBe(
    'offline_access https://graph.microsoft.com/Calendars.Read',
  );
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  const fetcher = vi.fn().mockResolvedValue(json({ access_token: 'at', refresh_token: 'rotated' }));
  vi.stubGlobal('fetch', fetcher);
  expect(await client.exchangeCode('code', 'verifier')).toMatchObject({ refreshToken: 'rotated' });
  expect(fetcher.mock.calls[0]![1].body.get('code_verifier')).toBe('verifier');
});

it('follows Outlook event pages, requests immutable UTC occurrences and normalizes timestamps', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json({ value: [{ id: 'school', name: 'School' }] }))
    .mockResolvedValueOnce(
      json({
        value: [
          {
            id: 'one',
            subject: 'CSC108 Midterm',
            start: { dateTime: '2026-10-28T14:00:00' },
            end: { dateTime: '2026-10-28T16:00:00' },
            isAllDay: false,
          },
        ],
        '@odata.nextLink':
          'https://graph.microsoft.com/v1.0/me/calendars/school/calendarView?skip=2',
      }),
    )
    .mockResolvedValueOnce(
      json({
        value: [
          {
            id: 'two',
            subject: 'Homework due',
            start: { dateTime: '2026-10-29T14:00:00Z' },
            end: { dateTime: '2026-10-29T15:00:00Z' },
            isAllDay: false,
          },
        ],
      }),
    );
  vi.stubGlobal('fetch', fetcher);
  const result = await outlook().events('at', '2026-10-01T00:00:00Z', '2027-04-01T00:00:00Z');
  expect(result).toHaveLength(2);
  expect(result[0]?.start).toBe('2026-10-28T14:00:00Z');
  expect(result[1]?.start).toBe('2026-10-29T14:00:00Z');
  expect(fetcher.mock.calls[1]![1].headers.Prefer).toContain('IdType="ImmutableId"');
});

it('does not forward Outlook tokens to an unexpected pagination host', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(json({ value: [], '@odata.nextLink': 'https://foreign.example/steal' }));
  vi.stubGlobal('fetch', fetcher);
  await expect(outlook().events('at', 'from', 'to')).rejects.toThrow('pagination URL');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('reports revoked Outlook refresh grants', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'invalid_grant' }, 400)));
  await expect(outlook().refreshAccessToken('rt')).rejects.toBeInstanceOf(OutlookRevokedError);
});
