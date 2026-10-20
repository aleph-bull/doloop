/**
 * Error reports and the feedback link for a closed test. Both are off unless configured:
 *
 *  - VITE_SENTRY_DSN: crashes and unhandled errors go to Sentry. Errors only: no session
 *    replay, no performance tracing, no personal data (the SDK default). The SDK is
 *    loaded on its own after start-up, so builds without a DSN never download it.
 *  - VITE_FEEDBACK_URL: a form (Tally, Google Forms…) linked from the top bar.
 */
const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

export const FEEDBACK_URL = (import.meta.env.VITE_FEEDBACK_URL as string | undefined) || null;

type Capture = (err: unknown) => void;
let capture: Capture | null = null;
const early: unknown[] = [];

export function initMonitoring(): void {
  if (!DSN || !import.meta.env.PROD) return;
  void import('@sentry/react')
    .then((Sentry) => {
      Sentry.init({
        dsn: DSN,
        environment: import.meta.env.MODE,
        tracesSampleRate: 0,
      });
      capture = (err) => Sentry.captureException(err);
      for (const err of early.splice(0)) capture(err);
    })
    .catch(() => {
      /* reporting is best-effort */
    });
}

/** Report an error the app caught itself (error boundaries); a no-op when Sentry is off. */
export function reportError(err: unknown): void {
  if (!DSN || !import.meta.env.PROD) return;
  if (capture) capture(err);
  else if (early.length < 10) early.push(err);
}
