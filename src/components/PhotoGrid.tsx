import Link from "next/link";
import { formatDateShort, type Photo } from "@/lib/photos";

/**
 * The archive. Bare thumbnails, newest first — no polaroid frame here, that
 * restraint is deliberate. The date only appears on hover/focus.
 */
export function PhotoGrid({ photos }: { photos: Photo[] }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {photos.map((photo) => {
        const alt = photo.alt || photo.caption || formatDateShort(photo.date);
        return (
          <Link
            key={photo.id}
            href={`/photo/${photo.id}`}
            className="group relative block aspect-[4/5] overflow-hidden bg-undeveloped"
          >
            <img
              src={photo.thumb}
              width={photo.width}
              height={photo.height}
              alt={alt}
              loading="lazy"
              decoding="async"
              // Uniform tiles: the archive reads as one wall rather than a
              // ragged row per orientation. Cropping is the trade — the
              // uncropped frame is one click away.
              className="block h-full w-full object-cover"
              style={
                photo.blur
                  ? {
                      backgroundImage: `url(${photo.blur})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : undefined
              }
            />
            <span className="label-mono pointer-events-none absolute bottom-1.5 left-1.5 bg-print/90 px-1.5 py-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
              {formatDateShort(photo.date)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
