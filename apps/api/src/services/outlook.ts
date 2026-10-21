import type { AcademicEvent } from './calendar-recognition';

export interface OutlookTokens {
  accessToken: string;
  refreshToken: string | null;
}
export interface OutlookClient {
  authUrl(state: string, challenge: string): string;
  exchangeCode(code: string, verifier: string): Promise<OutlookTokens>;
  refreshAccessToken(token: string): Promise<OutlookTokens>;
  events(token: string, from: string, to: string): Promise<AcademicEvent[]>;
}

export class OutlookRevokedError extends Error {
  constructor() {
    super('Outlook access expired. Reconnect in Settings.');
  }
}

export function createOutlookClient(config: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tenant: string;
}): OutlookClient {
  const auth = `https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0`;
  const graph = 'https://graph.microsoft.com/v1.0';
  const scope = 'offline_access https://graph.microsoft.com/Calendars.Read';
  async function token(params: Record<string, string>): Promise<OutlookTokens> {
    const response = await fetch(`${auth}/token`, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope,
        ...params,
      }),
    });
    const data = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
    };
    if (!response.ok || !data.access_token) {
      if (data.error === 'invalid_grant' || data.error === 'interaction_required')
        throw new OutlookRevokedError();
      throw new Error(`Outlook authorization failed (${response.status}).`);
    }
    return { accessToken: data.access_token, refreshToken: data.refresh_token ?? null };
  }
  async function pages<T>(accessToken: string, url: string): Promise<T[]> {
    const items: T[] = [];
    let next: string | undefined = url;
    while (next) {
      // Never send a bearer token to a host supplied by event content or a foreign nextLink.
      if (!next.startsWith(`${graph}/`)) throw new Error('Unexpected Outlook pagination URL');
      const res = await fetch(next, {
        signal: AbortSignal.timeout(30_000),
        headers: {
          authorization: `Bearer ${accessToken}`,
          Prefer: 'outlook.timezone="UTC", IdType="ImmutableId"',
        },
      });
      if (res.status === 401) throw new OutlookRevokedError();
      if (!res.ok) throw new Error(`Outlook calendar request failed (${res.status}).`);
      const data = (await res.json()) as { value?: T[]; '@odata.nextLink'?: string };
      items.push(...(data.value ?? []));
      next = data['@odata.nextLink'];
    }
    return items;
  }
  const utc = (dateTime: string) =>
    /(?:Z|[+-]\d\d:\d\d)$/i.test(dateTime) ? dateTime : `${dateTime}Z`;
  return {
    authUrl(state, challenge) {
      return `${auth}/authorize?${new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        response_mode: 'query',
        scope,
        state,
        prompt: 'select_account',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })}`;
    },
    exchangeCode: (code, verifier) =>
      token({
        code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: config.redirectUri,
      }),
    refreshAccessToken: (refreshToken) =>
      token({ refresh_token: refreshToken, grant_type: 'refresh_token' }),
    async events(at, from, to) {
      const calendars = await pages<{ id: string; name: string }>(at, `${graph}/me/calendars`);
      const events: AcademicEvent[] = [];
      for (const calendar of calendars) {
        const query = new URLSearchParams({ startDateTime: from, endDateTime: to, $top: '250' });
        const rows = await pages<{
          id: string;
          subject?: string;
          bodyPreview?: string;
          isAllDay: boolean;
          isCancelled?: boolean;
          start: { dateTime: string };
          end: { dateTime: string };
        }>(at, `${graph}/me/calendars/${encodeURIComponent(calendar.id)}/calendarView?${query}`);
        for (const row of rows) {
          if (!row.start?.dateTime || !row.end?.dateTime) continue;
          events.push({
            id: row.id,
            title: row.subject ?? 'Calendar event',
            description: row.bodyPreview,
            calendarId: calendar.id,
            calendarName: calendar.name,
            start: utc(row.start.dateTime),
            end: utc(row.end.dateTime),
            allDay: row.isAllDay,
            cancelled: row.isCancelled,
          });
        }
      }
      return events;
    },
  };
}
