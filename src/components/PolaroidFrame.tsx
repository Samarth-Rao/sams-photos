import type { Photo } from "@/lib/photos";

type PolaroidFrameProps = {
  photo: Photo;
  /** Already formatted — callers choose short or long form. */
  dateLabel: string;
  /** Runs the develop-in animation. Hero only — never grid thumbnails. */
  develop?: boolean;
  /** Above-the-fold image: loads eager instead of lazy. */
  priority?: boolean;
  className?: string;
};

/**
 * A photo presented as an actual instant print: thin border on three sides,
 * a fat bottom chin (~4x the side border) holding the caption and date.
 * Used for the home hero and the single-photo page — nowhere else.
 */
export function PolaroidFrame({
  photo,
  dateLabel,
  develop = false,
  priority = true,
  className = "",
}: PolaroidFrameProps) {
  const alt = photo.alt || photo.caption || dateLabel;

  // A portrait print at the full 620px runs past the fold on most screens and
  // buries the archive. Narrowing it keeps the whole print in view without
  // letterboxing the image inside the frame.
  const maxWidth = photo.height > photo.width ? 460 : 620;

  return (
    <div
      className={`mx-auto w-full bg-print shadow-[0_1px_2px_rgba(22,24,26,0.08),0_10px_24px_-12px_rgba(22,24,26,0.18)] ${className}`}
      style={{ maxWidth }}
    >
      {/* Thin border: top/left/right only. */}
      <div className="px-3 pt-3">
        <div className="relative">
          <img
            src={photo.full}
            width={photo.width}
            height={photo.height}
            alt={alt}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            fetchPriority={priority ? "high" : undefined}
            className={`block h-auto w-full ${develop ? "developing" : ""}`}
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
          {develop && (
            <div
              className="developing-wash pointer-events-none absolute inset-0"
              aria-hidden="true"
            />
          )}
        </div>
      </div>

      {/* Fat chin: roughly 4x the side border, holds caption + date. */}
      <div className="flex items-end justify-between gap-4 px-3 py-3.5">
        <p className="min-w-0 truncate text-[15px] leading-snug text-ink">
          {photo.caption}
        </p>
        <p className="label-mono shrink-0">{dateLabel}</p>
      </div>
    </div>
  );
}
