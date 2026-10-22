import type { FastifyInstance } from 'fastify';
import { isValidTimezone } from '@komogon/core';
import { z } from 'zod';
import type { Db } from '../db/client';
import { HttpError } from '../errors';
import { accountSession } from '../services/account-session';
import { createDevAccount, DEV_ACCOUNT_LIFE_SECONDS, DEV_KINDS } from '../services/dev-accounts';
import type { MediaStore } from '../services/media-store';
import { checkPassword } from '../services/passwords';
import { RateLimiter, checkLimits, type Limit } from '../services/rate-limit';

export interface DevLoginOptions {
  /** HS256 secret the API signs its own tokens with (`AUTH_SECRET`). */
  secret: string;
  /** scrypt hash of the dev password (`DEV_PASSWORD_HASH`). */
  passwordHash: string;
  clock: () => string;
  /** R2, so expired dev accounts' post files are deleted with them. */
  store?: MediaStore | null;
  /** Wrong passwords and new accounts per address; null turns them off (tests). */
  limits?: { wrong: Limit; made: Limit; now?: () => number } | null;
}

const MINUTE = 60 * 1000;
const DEFAULT_LIMITS: NonNullable<DevLoginOptions['limits']> = {
  wrong: { max: 10, windowMs: 15 * MINUTE },
  made: { max: 30, windowMs: 60 * MINUTE },
};

/**
 * "I'm a dev" on the sign-in page: the dev password answers a token for a brand-new
 * throwaway account (services/dev-accounts.ts), fresh or Jerry. GET says the button can show.
 */
export function devLoginRoutes(app: FastifyInstance, db: Db, opts: DevLoginOptions) {
  const limits = opts.limits === undefined ? DEFAULT_LIMITS : opts.limits;
  const wrong = limits && new RateLimiter(limits.wrong, limits.now);
  const made = limits && new RateLimiter(limits.made, limits.now);

  app.get('/api/auth/dev', { config: { public: true } }, async () => ({ enabled: true }));

  app.post('/api/auth/dev', { config: { public: true } }, async (req) => {
    if (wrong && made)
      checkLimits([
        [wrong, req.ip],
        [made, req.ip],
      ]);
    const { password, kind } = z
      .object({ password: z.string().min(1).max(200), kind: z.enum(DEV_KINDS).default('fresh') })
      .parse(req.body);
    if (!(await checkPassword(password, opts.passwordHash))) {
      wrong?.hit(req.ip);
      throw new HttpError(401, "That isn't the dev password.");
    }
    made?.hit(req.ip);
    const tz = req.headers['x-timezone'];
    const identity = await createDevAccount(
      db,
      kind,
      typeof tz === 'string' && isValidTimezone(tz) ? tz : null,
      opts.clock(),
      opts.store ?? null,
      req.log,
    );
    return accountSession(db, opts.secret, identity, DEV_ACCOUNT_LIFE_SECONDS);
  });
}
