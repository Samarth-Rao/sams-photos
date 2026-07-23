import { cookies } from "next/headers";
import {
  checkPassword,
  clearFailures,
  createSessionToken,
  isAuthConfigured,
  rateLimit,
  recordFailure,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth";

function clientIp(request: Request): string {
  // Trusts the platform's proxy to set this — fine here since there's no
  // authorization decision riding on the IP, only a soft throttle.
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: Request) {
  if (!isAuthConfigured()) {
    return Response.json({ error: "Auth is not configured on the server." }, { status: 500 });
  }

  const ip = clientIp(request);
  const limit = rateLimit(ip);
  if (!limit.ok) {
    return Response.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  let password: unknown;
  try {
    const body = await request.json();
    password = body?.password;
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  // Same response whether the field was missing or just wrong.
  if (typeof password !== "string" || !checkPassword(password)) {
    recordFailure(ip);
    return Response.json({ error: "Incorrect password." }, { status: 401 });
  }

  clearFailures(ip);
  (await cookies()).set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions());
  return Response.json({ ok: true });
}
