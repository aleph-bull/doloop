/**
 * Google Calendar client boundary. The sync service only talks to this interface, so
 * tests use an in-memory fake and production uses the REST implementation below.
 */

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number; // epoch ms
}

export interface GoogleEvent {
  id: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  updated?: string;
  extendedProperties?: { private?: Record<string, string> };
}

export interface EventInput {
  summary: string;
  description?: string;
  start: string; // ISO
  end: string; // ISO
  /** Marks events created by Komogon. */
  komogonBlockId?: string;
}

export interface ListEventsResult {
  items: GoogleEvent[];
  nextSyncToken: string | null;
}

export class GoogleRevokedError extends Error {
  constructor() {
    super('Google access was revoked. Reconnect in settings.');
  }
}

export class GoogleSyncTokenExpiredError extends Error {
  constructor() {
    super('Sync token expired; full resync required.');
  }
}

export interface GoogleCalendarClient {
  authUrl(state: string): string;
  exchangeCode(code: string): Promise<GoogleTokens>;
  refreshAccessToken(refreshToken: string): Promise<GoogleTokens>;
  listCalendars(accessToken: string): Promise<Array<{ id: string; summary: string }>>;
  createCalendar(accessToken: string, summary: string): Promise<{ id: string }>;
  insertEvent(accessToken: string, calendarId: string, event: EventInput): Promise<{ id: string }>;
  updateEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    event: EventInput,
  ): Promise<void>;
  deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void>;
  listEvents(
    accessToken: string,
    calendarId: string,
    opts: { syncToken?: string | null; timeMin?: string },
  ): Promise<ListEventsResult>;
  freeBusy(
    accessToken: string,
    calendarId: string,
    timeMin: string,
    timeMax: string,
  ): Promise<Array<{ start: string; end: string }>>;
}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
];

function toEventBody(e: EventInput) {
  return {
    summary: e.summary,
    description: e.description,
    start: { dateTime: e.start },
    end: { dateTime: e.end },
    extendedProperties: e.komogonBlockId
      ? { private: { komogonBlockId: e.komogonBlockId } }
      : undefined,
  };
}

/** REST implementation. Only used when GOOGLE_CLIENT_ID/SECRET are configured. */
export function createGoogleClient(cfg: GoogleConfig): GoogleCalendarClient {
  const API = 'https://www.googleapis.com/calendar/v3';

  async function call<T>(
    accessToken: string,
    method: string,
    url: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) throw new GoogleRevokedError();
    if (res.status === 410) throw new GoogleSyncTokenExpiredError();
    if (res.status === 204) return undefined as T;
    if (!res.ok)
      throw new Error(`Google API ${method} ${url} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  async function token(params: Record<string, string>): Promise<GoogleTokens> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        ...params,
      }),
    });
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!res.ok || !data.access_token) {
      if (data.error === 'invalid_grant') throw new GoogleRevokedError();
      throw new Error(`Google token error: ${data.error ?? res.status}`);
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
  }

  return {
    authUrl(state) {
      const q = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    },
    exchangeCode: (code) =>
      token({ code, grant_type: 'authorization_code', redirect_uri: cfg.redirectUri }),
    refreshAccessToken: (refreshToken) =>
      token({ refresh_token: refreshToken, grant_type: 'refresh_token' }),
    async listCalendars(at) {
      const r = await call<{ items?: Array<{ id: string; summary: string }> }>(
        at,
        'GET',
        `${API}/users/me/calendarList`,
      );
      return r.items ?? [];
    },
    async createCalendar(at, summary) {
      return call<{ id: string }>(at, 'POST', `${API}/calendars`, { summary });
    },
    async insertEvent(at, calendarId, event) {
      return call<{ id: string }>(
        at,
        'POST',
        `${API}/calendars/${encodeURIComponent(calendarId)}/events`,
        toEventBody(event),
      );
    },
    async updateEvent(at, calendarId, eventId, event) {
      await call(
        at,
        'PATCH',
        `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        toEventBody(event),
      );
    },
    async deleteEvent(at, calendarId, eventId) {
      try {
        await call(
          at,
          'DELETE',
          `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        );
      } catch (err) {
        if (err instanceof Error && /404|410/.test(err.message)) return;
        throw err;
      }
    },
    async listEvents(at, calendarId, opts) {
      const items: GoogleEvent[] = [];
      let pageToken: string | undefined;
      let nextSyncToken: string | null = null;
      do {
        const q = new URLSearchParams({
          singleEvents: 'true',
          maxResults: '250',
          showDeleted: 'true',
        });
        if (opts.syncToken) q.set('syncToken', opts.syncToken);
        else if (opts.timeMin) q.set('timeMin', opts.timeMin);
        if (pageToken) q.set('pageToken', pageToken);
        const r = await call<{
          items?: GoogleEvent[];
          nextPageToken?: string;
          nextSyncToken?: string;
        }>(at, 'GET', `${API}/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
        items.push(...(r.items ?? []));
        pageToken = r.nextPageToken;
        if (r.nextSyncToken) nextSyncToken = r.nextSyncToken;
      } while (pageToken);
      return { items, nextSyncToken };
    },
    async freeBusy(at, calendarId, timeMin, timeMax) {
      const r = await call<{
        calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
      }>(at, 'POST', `${API}/freeBusy`, {
        timeMin,
        timeMax,
        items: [{ id: calendarId }],
      });
      return r.calendars?.[calendarId]?.busy ?? [];
    },
  };
}
