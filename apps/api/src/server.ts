import cors from '@fastify/cors';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { authPlugin } from './auth/plugin';
import type { Verifier } from './auth/verify';
import type { Db } from './db/client';
import { HttpError } from './errors';
import { meRoutes } from './routes/me';
import { nodeRoutes } from './routes/nodes';
import { plannedBlockRoutes } from './routes/planned-blocks';
import { restDayRoutes } from './routes/rest-days';
import { sessionRoutes } from './routes/sessions';
import { quoteRoutes } from './routes/quote';
import { analyticsRoutes } from './routes/analytics';
import { calendarRoutes, type CalendarRouteOptions } from './routes/calendar';
import { shopRoutes } from './routes/shop';
import { assetRoutes } from './routes/assets';
import { rewardRoutes } from './routes/rewards';
import { routineRoutes } from './routes/routines';
import { trackerRoutes } from './routes/trackers';
import { gradeRoutes } from './routes/grades';
import { spotifyRoutes, type SpotifyRouteOptions } from './routes/spotify';

export interface BuildOptions {
  db: Db;
  verifier: Verifier;
  logger?: boolean;
  corsOrigins?: string[];
  /** Injectable clock for tests. */
  clock?: () => string;
  /** Google Calendar integration; null disables the connect flow. */
  calendar?: Partial<CalendarRouteOptions>;
  /** Spotify integration for the focus screen; null disables the connect flow. */
  spotify?: Partial<SpotifyRouteOptions>;
}

/** Build the Fastify app without listening, so tests can inject requests. */
export async function buildServer(opts: BuildOptions) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 8 * 1024 * 1024 });
  const clock = opts.clock ?? (() => new Date().toISOString());

  await app.register(cors, {
    origin: opts.corsOrigins ?? true,
    credentials: true,
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'Validation failed', issues: err.issues });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.message, details: err.details });
    }
    const status =
      typeof (err as { statusCode?: number }).statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;
    if (status >= 500) app.log.error(err);
    return reply
      .code(status)
      .send({ error: status >= 500 ? 'Internal error' : (err as Error).message });
  });

  app.get('/api/health', { config: { public: true } }, async () => ({
    ok: true,
    service: 'doloop-api',
  }));

  await app.register(authPlugin, { db: opts.db, verifier: opts.verifier });

  const calendar: CalendarRouteOptions = {
    deps: opts.calendar?.deps ?? null,
    stateSecret: opts.calendar?.stateSecret ?? 'dev-state-secret',
    portalUrl: opts.calendar?.portalUrl ?? 'http://localhost:5173',
  };
  const spotify: SpotifyRouteOptions = {
    deps: opts.spotify?.deps ?? null,
    stateSecret: opts.spotify?.stateSecret ?? calendar.stateSecret,
    portalUrl: opts.spotify?.portalUrl ?? calendar.portalUrl,
  };
  meRoutes(app, opts.db, clock);
  nodeRoutes(app, opts.db, clock);
  // Sessions need the calendar deps: a finished session is written to the calendar.
  sessionRoutes(app, opts.db, clock, calendar.deps);
  plannedBlockRoutes(app, opts.db, clock, calendar.deps);
  calendarRoutes(app, opts.db, clock, calendar);
  shopRoutes(app, opts.db, clock);
  rewardRoutes(app, opts.db, clock);
  routineRoutes(app, opts.db, clock);
  trackerRoutes(app, opts.db, clock);
  gradeRoutes(app, opts.db, clock);
  assetRoutes(app, opts.db, clock);
  restDayRoutes(app, opts.db, clock);
  quoteRoutes(app, opts.db, clock);
  analyticsRoutes(app, opts.db, clock);
  spotifyRoutes(app, opts.db, clock, spotify);

  return app;
}
