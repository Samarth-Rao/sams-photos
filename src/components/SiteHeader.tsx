import Link from "next/link";
import type { Streak } from "@/lib/photos";

/**
 * Thin, all-mono chrome. Left is the site, right is the practice's vitals —
 * day count and current streak. A hairline rule separates it from the page.
 */
export function SiteHeader({ streak }: { streak: Streak }) {
  return (
    <header className="border-b border-hairline">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="label-mono no-underline">
          sam&apos;s polaroids
        </Link>
        <p className="label-mono">
          day {streak.totalDays} · streak {streak.current}
        </p>
      </div>
    </header>
  );
}
