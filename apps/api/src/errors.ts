export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const conflict = (msg: string) => new HttpError(409, msg);
export const forbidden = (msg = 'Forbidden') => new HttpError(403, msg);

/** Postgres's unique_violation, from the driver or wrapped by Drizzle. */
export function isUniqueViolation(err: unknown): boolean {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined, i = 0; e && i < 4; i++) {
    if (e.code === '23505') return true;
    e = e.cause as typeof e;
  }
  return false;
}
