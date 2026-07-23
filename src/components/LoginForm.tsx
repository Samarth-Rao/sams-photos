"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * One shared password, not an account system — see src/lib/auth.ts. Success
 * just means "the cookie is now set"; router.refresh() re-runs the server
 * component above us, which reads that cookie and swaps in the Uploader.
 */
export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChecking(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.refresh();
        return;
      }

      const body = await res.json().catch(() => ({}) as { error?: string });

      if (res.status === 429) {
        const retryAfter = res.headers.get("Retry-After");
        setError(
          retryAfter
            ? `Too many attempts. Try again in ${retryAfter}s.`
            : (body.error ?? "Too many attempts. Try again later."),
        );
      } else {
        setError(body.error ?? "Incorrect password.");
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex max-w-sm flex-col gap-6 py-16">
      <div>
        <h1 className="display-expanded text-2xl">Locked.</h1>
        <p className="mt-2 leading-relaxed text-graphite">
          The password gets you to the uploader. Nothing else on this site
          needs it.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
        <label htmlFor="upload-password" className="label-mono">
          password
        </label>
        <input
          id="upload-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={checking}
          className="border border-hairline bg-print px-3 py-2 text-ink outline-none disabled:opacity-60"
        />

        {error && (
          <p role="alert" className="text-sm leading-relaxed text-ink">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={checking || password.length === 0}
          className="label-mono border border-ink bg-ink px-4 py-2.5 text-print disabled:cursor-not-allowed disabled:opacity-40"
        >
          {checking ? "checking…" : "enter"}
        </button>
      </form>
    </div>
  );
}
