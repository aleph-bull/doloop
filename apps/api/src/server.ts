import cors from '@fastify/cors';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { authPlugin } from './auth/plugin';
import type { Verifier } from './auth/verify';
import type { Db } from './db/client';
import { HttpError } from './errors';
import { TooManyTries } from './services/rate-limit';
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
import { planRoutes } from './routes/plans';
import { recapRoutes } from './routes/recap';
import { passwordAuthRoutes, type PasswordAuthOptions } from './routes/auth';
import { adminRoutes } from './routes/admin';
import { leaderboardRoutes } from './routes/leaderboard';
import type { FetchLike, TmdbCredentials } from './services/tmdb';
import { LOCAL_TEST_ACCOUNTS, seedLocalTestAccounts } from './services/local-test-accounts';
import { emailAuthRoutes } from './routes/email-auth';
import { socialRoutes } from './routes/social';
import type { Mailer } from './services/mailer';

export interface BuildOptions {
  db: Db;
  verifier: Verifier;
  logger?: boolean;
  corsOrigins?: string[];
  /** Invite list for a closed test (`ALLOWED_EMAILS`); empty lets everyone in. */
  allowedEmails?: string[];
  /** Email-and-password accounts kept by the API (`AUTH_SECRET`); null leaves them off. */
  passwordAuth?: {
    secret: string;
    google?: PasswordAuthOptions['google'];
    limits?: PasswordAuthOptions['limits'];
  } | null;
  /**
   * How many proxies in front of the API to trust for the caller's address
   * (`TRUST_PROXY_HOPS`), so sign-in limits count real callers. 0 trusts none.
   */
  trustProxyHops?: number;
  /** Who can see every account and its data (`ADMIN_EMAILS`). */
  adminEmails?: string[];
  localTestAccounts?: boolean;
  mailer?: Mailer | null;
  requireEmailVerification?: boolean;
  /** Injectable clock for tests. */
  clock?: () => string;
  /** Google Calendar integration; null disables the connect flow. */
  calendar?: Partial<CalendarRouteOptions>;
  /** TMDB for the equivalents strip's posters; null uses the listed runtimes. */
  tmdb?: TmdbCredentials | null;
  /** Injectable fetch for the TMDB lookups, for tests. */
  tmdbFetch?: FetchLike;
}

/** Build the Fastify app without listening, so tests can inject requests. */
export async function buildServer(opts: BuildOptions) {
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 8 * 1024 * 1024,
    // Trust only the nearest hops, not `true`: `true` takes the leftmost X-Forwarded-For
    // entry, which the caller can write themselves.
    trustProxy: (_address: string, hop: number) => hop < (opts.trustProxyHops ?? 0),
  });
  const clock = opts.clock ?? (() => new Date().toISOString());
  const admins = [
    ...(opts.adminEmails ?? []),
    ...(opts.localTestAccounts ? [LOCAL_TEST_ACCOUNTS[1].email] : []),
  ];
  if (opts.localTestAccounts) {
    if (!opts.passwordAuth) throw new Error('Local test accounts require password authentication.');
    await seedLocalTestAccounts(opts.db, clock());
  }

  await app.register(cors, {
    origin: opts.corsOrigins ?? true,
    credentials: true,
    // @fastify/cors allows only GET, HEAD and POST by default, which blocks every PATCH and
    // DELETE from a portal on another address (the hosted one; locally Vite proxies instead).
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'Validation failed', issues: err.issues });
    }
    if (err instanceof TooManyTries) reply.header('retry-after', String(err.retryAfterSeconds));
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
    service: 'komogon-api',
  }));

  if (opts.passwordAuth)
    passwordAuthRoutes(app, opts.db, {
      secret: opts.passwordAuth.secret,
      limits: opts.passwordAuth.limits,
      allowedEmails: opts.allowedEmails,
      adminEmails: admins,
      localTestAccounts: opts.localTestAccounts ?? false,
      mailer: opts.mailer,
      requireVerification: opts.requireEmailVerification ?? !!opts.mailer,
      clock,
      google: opts.passwordAuth.google,
    });

  await app.register(authPlugin, {
    db: opts.db,
    verifier: opts.verifier,
    allowedEmails: opts.allowedEmails,
    localTestAccounts: opts.localTestAccounts ?? false,
  });

  const calendar: CalendarRouteOptions = {
    deps: opts.calendar?.deps ?? null,
    outlook: opts.calendar?.outlook ?? null,
    autoSync: opts.calendar?.autoSync ?? false,
    stateSecret: opts.calendar?.stateSecret ?? 'dev-state-secret',
    portalUrl: opts.calendar?.portalUrl ?? 'http://localhost:5173',
  };
  const email = {
    mailer: opts.mailer ?? null,
    secret: opts.passwordAuth?.secret ?? calendar.stateSecret,
    verificationRequired: opts.requireEmailVerification ?? !!opts.mailer,
    localTestAccounts: opts.localTestAccounts ?? false,
    passwordAuth: !!opts.passwordAuth,
  };
  emailAuthRoutes(app, opts.db, clock, email);
  socialRoutes(app, opts.db, clock, email, admins);
  meRoutes(app, opts.db, clock);
  adminRoutes(app, opts.db, admins);
  leaderboardRoutes(app, opts.db, admins);
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
  planRoutes(app, opts.db, clock);
  assetRoutes(app, opts.db, clock);
  restDayRoutes(app, opts.db, clock);
  quoteRoutes(app, opts.db, clock);
  analyticsRoutes(app, opts.db, clock);
  recapRoutes(app, opts.db, clock, opts.tmdb ?? null, opts.tmdbFetch);

  return app;
}
