import Link from "next/link";
import { formatDate, type Photo } from "@/lib/photos";

type PhotoNavProps = {
  previous: Photo | null;
  next: Photo | null;
};

/** Previous/next navigation for a single photo, labelled by date. */
export function PhotoNav({ previous, next }: PhotoNavProps) {
  return (
    <nav
      aria-label="Adjacent photos"
      className="flex items-center justify-between gap-4"
    >
      {previous ? (
        <Link href={`/photo/${previous.id}`} className="label-mono no-underline">
          ← {formatDate(previous.date)}
        </Link>
      ) : (
        <span className="label-mono opacity-40">start of the archive</span>
      )}
      {next ? (
        <Link
          href={`/photo/${next.id}`}
          className="label-mono text-right no-underline"
        >
          {formatDate(next.date)} →
        </Link>
      ) : (
        <span className="label-mono text-right opacity-40">most recent</span>
      )}
    </nav>
  );
}
