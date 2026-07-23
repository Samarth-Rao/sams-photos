/**
 * Password gate for the upload flow. There's one shared password, not
 * per-user accounts, so a signed cookie is enough — no session store needed.
 *
 * Env vars:
 * - UPLOAD_PASSWORD: the shared password checked against on login.
 * - AUTH_SECRET: random string used to HMAC-sign session tokens. Anyone with
 *   this can mint valid sessions, so treat it like a credential.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "polaroids_session";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function isAuthConfigured(): boolean {
  return Boolean(process.env.UPLOAD_PASSWORD) && Boolean(process.env.AUTH_SECRET);
}

/**
 * SHA-256 both sides before comparing. `timingSafeEqual` requires equal-length
 * buffers and throws otherwise — but the length mismatch itself is a timing
 * signal, so hashing first (fixed 32-byte digests either way) removes the
 * length as a variable rather than just avoiding the throw.
 */
export function checkPassword(input: string): boolean {
  if (!isAuthConfigured()) return false;
  const expected = createHash("sha256").update(process.env.UPLOAD_PASSWORD!).digest();
  const actual = createHash("sha256").update(input).digest();
  return timingSafeEqual(expected, actual);
}

export function createSessionToken(ttlMs = THIRTY_DAYS_MS): string {
  const expiry = String(Date.now() + ttlMs);
  const hmac = createHmac("sha256", process.env.AUTH_SECRET!).update(expiry).digest("hex");
  return `${expiry}.${hmac}`;
}

/** Never throws, even on garbage input — this runs on every request. */
export function verifySessionToken(token: string | undefined): boolean {
  if (!token || !isAuthConfigured()) return false;

  const dot = token.indexOf(".");
  if (dot === -1) return false;
  const expiry = token.slice(0, dot);
  const hmac = token.slice(dot + 1);
  if (!/^\d+$/.test(expiry)) return false;

  const expected = createHmac("sha256", process.env.AUTH_SECRET!).update(expiry).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(hmac, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  if (!timingSafeEqual(expectedBuf, actualBuf)) return false;

  return Number(expiry) > Date.now();
}

export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: THIRTY_DAYS_MS / 1000,
  };
}

/** Route handlers call this first and return the Response if it's non-null. */
export async function requireAuth(): Promise<Response | null> {
  if (await isAuthenticated()) return null;
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

/* -------------------------------------------------------------------------- */
/* Failed-attempt throttle                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A module-level Map only persists for the life of one serverless instance —
 * a cold start, a redeploy, or just a different instance handling the next
 * request all reset it. This slows down casual password guessing; it is not
 * a real rate limit and shouldn't be relied on as the only defence.
 */
const attempts = new Map<string, { count: number; windowStart: number }>();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export function rateLimit(ip: string): { ok: boolean; retryAfterSec?: number } {
  const entry = attempts.get(ip);
  if (!entry) return { ok: true };

  const elapsed = Date.now() - entry.windowStart;
  if (elapsed > WINDOW_MS) return { ok: true };

  if (entry.count >= MAX_ATTEMPTS) {
    return { ok: false, retryAfterSec: Math.ceil((WINDOW_MS - elapsed) / 1000) };
  }
  return { ok: true };
}

export function recordFailure(ip: string): void {
  const entry = attempts.get(ip);
  const now = Date.now();
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    attempts.set(ip, { count: 1, windowStart: now });
  } else {
    entry.count++;
  }
}

export function clearFailures(ip: string): void {
  attempts.delete(ip);
}
