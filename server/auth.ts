import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Pool } from './db';
import { HttpError } from './errors';

export const COOKIE_NAME = 'loop_session';

const sha256 = (s: string) => createHash('sha256').update(s).digest();
export const hashToken = (token: string) => sha256(token).toString('hex');

/** Constant-time comparison of the submitted key against the configured one. */
export function keyMatches(submitted: string, expected: string): boolean {
  return timingSafeEqual(sha256(submitted), sha256(expected));
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

/** Fixed-window limiter for failed login attempts, keyed by client IP. */
export class LoginLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private max = 8,
    private windowMs = 15 * 60_000,
  ) {}

  check(key: string, now = Date.now()) {
    const h = this.hits.get(key);
    if (h && h.resetAt > now && h.count >= this.max) {
      throw new HttpError(429, 'too_many_attempts', 'Too many attempts. Try again later.');
    }
  }

  fail(key: string, now = Date.now()) {
    const h = this.hits.get(key);
    if (!h || h.resetAt <= now) this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
    else h.count += 1;
    if (this.hits.size > 5000) {
      for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    }
  }

  clear(key: string) {
    this.hits.delete(key);
  }
}

export async function createAuthSession(pool: Pool, ttlDays: number, userAgent: string | undefined) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
  await pool.query(
    'INSERT INTO auth_sessions (token_hash, expires_at, user_agent) VALUES ($1, $2, $3)',
    [hashToken(token), expiresAt, (userAgent ?? '').slice(0, 300)],
  );
  // Opportunistic cleanup of expired sessions.
  await pool.query('DELETE FROM auth_sessions WHERE expires_at < now()');
  return { token, expiresAt };
}

export async function isValidSession(pool: Pool, token: string | undefined): Promise<boolean> {
  if (!token || token.length > 200) return false;
  const { rows } = await pool.query<{ last_seen: Date }>(
    'SELECT last_seen FROM auth_sessions WHERE token_hash = $1 AND expires_at > now()',
    [hashToken(token)],
  );
  if (!rows[0]) return false;
  if (Date.now() - rows[0].last_seen.getTime() > 3_600_000) {
    await pool.query('UPDATE auth_sessions SET last_seen = now() WHERE token_hash = $1', [hashToken(token)]);
  }
  return true;
}

export async function destroySession(pool: Pool, token: string | undefined) {
  if (token) await pool.query('DELETE FROM auth_sessions WHERE token_hash = $1', [hashToken(token)]);
}

export function requireAuth(pool: Pool) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
      if (!(await isValidSession(pool, token))) throw new HttpError(401, 'unauthorized', 'Sign in required');
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * State-changing requests must carry a custom header. Browsers cannot attach custom
 * headers cross-origin without a CORS preflight (which this API never grants),
 * so this blocks cross-site request forgery on top of SameSite cookies.
 */
export function requireClientHeader(req: Request, _res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.get('x-loop-client') !== '1') return next(new HttpError(403, 'forbidden', 'Missing client header'));
  next();
}
