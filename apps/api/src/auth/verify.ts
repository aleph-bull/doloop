import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from 'jose';

export interface AuthUser {
  id: string;
  email: string | null;
  authVersion?: number;
}

export interface Verifier {
  verify(token: string): Promise<AuthUser>;
}

export class AuthError extends Error {
  status = 401 as const;
}

function toUser(payload: JWTPayload): AuthUser {
  if (!payload.sub) throw new AuthError('Token has no subject');
  const email = typeof payload.email === 'string' ? payload.email : null;
  return {
    id: payload.sub,
    email,
    authVersion: typeof payload.authVersion === 'number' ? payload.authVersion : 0,
  };
}

/** HS256 verifier for a shared secret (Supabase legacy JWT secret, or a dev secret). */
export function createHsVerifier(secret: string): Verifier {
  const key = new TextEncoder().encode(secret);
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
        return toUser(payload);
      } catch (err) {
        throw new AuthError(err instanceof Error ? err.message : 'Invalid token');
      }
    },
  };
}

/**
 * Supabase verifier: tries the project's JWKS (asymmetric signing keys) first, then
 * falls back to the legacy HS256 secret when configured.
 */
export function createSupabaseVerifier(opts: {
  supabaseUrl: string;
  jwtSecret?: string;
}): Verifier {
  const jwks = createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', opts.supabaseUrl));
  const hs = opts.jwtSecret ? createHsVerifier(opts.jwtSecret) : null;
  const issuer = new URL('/auth/v1', opts.supabaseUrl).toString();
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, jwks, { issuer });
        return toUser(payload);
      } catch (jwksErr) {
        if (hs) return hs.verify(token);
        throw new AuthError(jwksErr instanceof Error ? jwksErr.message : 'Invalid token');
      }
    },
  };
}

/** Mint a dev/test token. Never used in production. */
export async function signDevToken(
  secret: string,
  user: { id: string; email: string; authVersion?: number },
  ttlSeconds = 3600,
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ email: user.email, authVersion: user.authVersion ?? 0 })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(key);
}
