import Link from "next/link";

type EmptyStateProps = {
  /** No bucket wired up yet, vs. wired up but nothing uploaded. */
  variant: "unconfigured" | "no-photos";
};

function Code({ children }: { children: string }) {
  return (
    <code className="label-mono border border-hairline bg-print px-1.5 py-0.5 text-ink normal-case">
      {children}
    </code>
  );
}

/**
 * The empty state is an invitation, not an apology — it tells you exactly
 * what to run next.
 */
export function EmptyState({ variant }: EmptyStateProps) {
  return (
    <>
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-5xl items-center px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="label-mono no-underline">
            sam&apos;s polaroids
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center gap-4 px-4 py-24 sm:px-6 lg:px-8">
        <h1 className="display-expanded text-3xl">
          {variant === "unconfigured" ? "Nothing developed yet." : "No frames yet."}
        </h1>
        {variant === "unconfigured" ? (
          <div className="max-w-md space-y-3 leading-relaxed text-ink">
            <p>This install isn&apos;t pointed at a photo bucket yet.</p>
            <p>
              Follow <Code>docs/R2-SETUP.md</Code> to set{" "}
              <Code>PHOTOS_BASE_URL</Code>, then run <Code>npm run upload</Code>{" "}
              to publish the first frame.
            </p>
          </div>
        ) : (
          <div className="max-w-md space-y-3 leading-relaxed text-ink">
            <p>The bucket is wired up. It&apos;s just empty.</p>
            <p>
              Shoot today&apos;s photo and post it from{" "}
              <Link href="/upload" className="text-reagent">
                /upload
              </Link>
              , or run <Code>npm run upload</Code> from your machine.
            </p>
          </div>
        )}
      </main>
    </>
  );
}
