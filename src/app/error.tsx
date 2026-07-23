"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

function Code({ children }: { children: string }) {
  return (
    <code className="label-mono border border-hairline bg-print px-1.5 py-0.5 text-ink normal-case">
      {children}
    </code>
  );
}

/**
 * The manifest fetch failed — not a code bug necessarily, but a
 * configuration or connectivity one. Say exactly what to check.
 */
export default function ErrorPage({ error, reset }: ErrorPageProps) {
  const router = useRouter();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center gap-4 px-4 py-24 sm:px-6 lg:px-8">
      <h1 className="display-expanded text-3xl">The manifest didn&apos;t load.</h1>
      <div className="max-w-md space-y-3 leading-relaxed text-ink">
        <p>
          <Code>PHOTOS_BASE_URL</Code> points at a bucket, but its{" "}
          <Code>manifest.json</Code> couldn&apos;t be read.
        </p>
        <p>
          Check that the bucket allows read access, that{" "}
          <Code>manifest.json</Code> exists at that path, and that the
          environment variable is set correctly.
        </p>
        {error.message && <p className="label-mono">{error.message}</p>}
      </div>
      <button
        type="button"
        // The failure came from a server-side fetch, so the server data has to
        // be refetched before the boundary is reset — otherwise this re-renders
        // the same cached failure.
        onClick={() => {
          router.refresh();
          reset();
        }}
        className="label-mono border border-ink px-3 py-2 text-ink"
      >
        Try again
      </button>
    </main>
  );
}
