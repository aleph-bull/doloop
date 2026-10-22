import { HttpError } from '../errors';

export interface Limit {
  /** Tries allowed in each window. */
  max: number;
  windowMs: number;
}

/**
 * Fixed-window counters kept in memory, keyed by whatever the caller chooses (an IP, an
 * email). Enough for one API process; a restart forgets them, which is fine for slowing
 * down password guessing.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private lastPrune = 0;

  constructor(
    private limit: Limit,
    private now: () => number = Date.now,
  ) {}

  /** Seconds until `key` may try again, or 0 when it is under the limit. */
  retryAfter(key: string): number {
    const entry = this.hits.get(key);
    const t = this.now();
    if (!entry || entry.resetAt <= t || entry.count < this.limit.max) return 0;
    return Math.ceil((entry.resetAt - t) / 1000);
  }

  /** Count one try against `key`. */
  hit(key: string): void {
    const t = this.now();
    this.prune(t);
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t)
      this.hits.set(key, { count: 1, resetAt: t + this.limit.windowMs });
    else entry.count += 1;
  }

  clear(key: string): void {
    this.hits.delete(key);
  }

  /** Drop finished windows now and then so the map doesn't grow without end. */
  private prune(t: number) {
    if (t - this.lastPrune < this.limit.windowMs) return;
    this.lastPrune = t;
    for (const [key, entry] of this.hits) if (entry.resetAt <= t) this.hits.delete(key);
  }
}

export class TooManyTries extends HttpError {
  constructor(
    public retryAfterSeconds: number,
    message = 'There have been too many tries. Please wait a few minutes and try again.',
  ) {
    super(429, message);
  }
}

/** Throw a 429 when any of the keys is over its limiter's limit. */
export function checkLimits(checks: [RateLimiter, string][]): void {
  const wait = Math.max(0, ...checks.map(([limiter, key]) => limiter.retryAfter(key)));
  if (wait > 0) throw new TooManyTries(wait);
}
