import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center gap-4 px-4 py-24 sm:px-6 lg:px-8">
      <h1 className="display-expanded text-3xl">No frame here.</h1>
      <p className="text-ink">That photo doesn&apos;t exist, or the link&apos;s wrong.</p>
      <Link
        href="/"
        className="label-mono border border-ink px-3 py-2 text-ink no-underline"
      >
        Back to the archive
      </Link>
    </main>
  );
}
