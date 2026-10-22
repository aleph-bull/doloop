import { AwsClient } from 'aws4fetch';

/**
 * Where post videos and pictures live when they are not in Postgres: a bucket the browser
 * uploads to and plays from directly, through short-lived signed links, so the bytes never
 * pass through the API or the database. Cloudflare R2 in production (any S3-compatible
 * store works); without one, posts keep their media in `post_media.data` as before.
 */
export interface MediaStore {
  /** A link the browser can PUT exactly this file to, for `expiresIn` seconds. */
  uploadUrl(key: string, mime: string, bytes: number, expiresIn: number): Promise<string>;
  /** A link to read the file, for `expiresIn` seconds. */
  readUrl(key: string, expiresIn: number): Promise<string>;
  /** The size and type of what is at `key`, or null when nothing is. */
  head(key: string): Promise<{ bytes: number; mime: string } | null>;
  /** Copy inside the bucket; the bytes never leave it. */
  copy(from: string, to: string): Promise<void>;
  /** Delete; a key that is already gone is fine. */
  remove(key: string): Promise<void>;
}

export interface R2Options {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Defaults to the account's R2 address; set for an EU bucket or a local stand-in. */
  endpoint?: string;
}

/** Keys are made by the API (uuids and a short extension), but encode them anyway. */
const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/');

export function createR2Store(opts: R2Options): MediaStore {
  const client = new AwsClient({
    accessKeyId: opts.accessKeyId,
    secretAccessKey: opts.secretAccessKey,
    service: 's3',
    region: 'auto',
  });
  const base = (opts.endpoint ?? `https://${opts.accountId}.r2.cloudflarestorage.com`).replace(
    /\/+$/,
    '',
  );
  const objectUrl = (key: string) => `${base}/${opts.bucket}/${encodeKey(key)}`;

  const presign = async (
    method: 'GET' | 'PUT',
    key: string,
    expiresIn: number,
    headers: Record<string, string> = {},
  ) => {
    const url = new URL(objectUrl(key));
    url.searchParams.set('X-Amz-Expires', String(expiresIn));
    // allHeaders signs Content-Type and Content-Length too (aws4fetch leaves them out by
    // default), so an upload link takes only the file it was made for.
    const signed = await client.sign(url.toString(), {
      method,
      headers,
      aws: { signQuery: true, allHeaders: true },
    });
    return signed.url;
  };

  const check = async (res: Response, what: string) => {
    if (res.ok) return;
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`R2 ${what} failed (${res.status}) ${detail}`);
  };

  return {
    uploadUrl: (key, mime, bytes, expiresIn) =>
      presign('PUT', key, expiresIn, { 'content-type': mime, 'content-length': String(bytes) }),
    readUrl: (key, expiresIn) => presign('GET', key, expiresIn),
    async head(key) {
      const res = await client.fetch(objectUrl(key), { method: 'HEAD' });
      if (res.status === 404) return null;
      await check(res, 'HEAD');
      return {
        bytes: Number(res.headers.get('content-length') ?? 0),
        mime: (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase(),
      };
    },
    async copy(from, to) {
      const res = await client.fetch(objectUrl(to), {
        method: 'PUT',
        headers: { 'x-amz-copy-source': `/${opts.bucket}/${encodeKey(from)}` },
      });
      await check(res, 'copy');
    },
    async remove(key) {
      const res = await client.fetch(objectUrl(key), { method: 'DELETE' });
      if (res.status !== 404) await check(res, 'DELETE');
    },
  };
}

/**
 * Delete files and carry on whatever happens: a miss leaves a stray file, which costs a
 * fraction of a cent, while failing the request would leave the person stuck.
 */
export async function removeAll(
  store: MediaStore,
  keys: string[],
  log: { warn: (obj: object, msg: string) => void },
): Promise<void> {
  for (const key of keys) {
    try {
      await store.remove(key);
    } catch (err) {
      log.warn({ err, key }, 'Could not delete a file from R2');
    }
  }
}

/** The store the env asks for (`R2_*`), or null to keep media in Postgres. */
export function mediaStoreFromEnv(r2: Partial<R2Options>): MediaStore | null {
  if (!r2.accountId && !r2.endpoint) return null;
  if (!r2.accessKeyId || !r2.secretAccessKey || !r2.bucket) {
    console.warn(
      '[api] R2 is half set up (need R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET); post media stays in Postgres.',
    );
    return null;
  }
  return createR2Store({
    accountId: r2.accountId ?? '',
    accessKeyId: r2.accessKeyId,
    secretAccessKey: r2.secretAccessKey,
    bucket: r2.bucket,
    endpoint: r2.endpoint,
  });
}
