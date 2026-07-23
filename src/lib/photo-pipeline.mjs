/**
 * Photo-processing core: rendering, dates, ids, and manifest merging.
 *
 * Pure — no filesystem, network, or S3 access. This is what makes it safe to
 * import from both the CLI (`scripts/upload.mjs`, plain Node) and a Next.js
 * route handler (TypeScript, via `allowJs`) without duplicating the logic in
 * either place. All I/O (reading files, talking to S3) stays in the caller
 * and in `./storage.mjs`.
 */

import exifr from "exifr";
import sharp from "sharp";

/** @typedef {{ id: string, date: string, caption?: string, alt?: string, width: number, height: number, full: string, thumb: string, blur?: string, takenAt?: string }} Photo */
/** @typedef {{ version: number, updatedAt: string, photos: Photo[] }} Manifest */

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Above this, the blur placeholder is no longer the "tiny inline data URI" it's meant to be. */
export const MAX_BLUR_BYTES = 1536;

/** @param {string} str */
export function isValidDate(str) {
  return DATE_RE.test(str);
}

/** YYYY-MM-DD using the machine's local calendar day, not UTC — avoids midnight-boundary shifts. */
export function formatDateLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The date, or the first `<date>-N` not already taken (in the manifest or earlier in this run). */
export function assignId(date, idsInUse) {
  if (!idsInUse.has(date)) return date;
  let n = 2;
  while (idsInUse.has(`${date}-${n}`)) n++;
  return `${date}-${n}`;
}

/**
 * Reads EXIF DateTimeOriginal from an image buffer, or null if absent/unreadable.
 * @param {Buffer} buffer
 * @returns {Promise<Date | null>}
 */
export async function readExifDate(buffer) {
  try {
    const exifData = await exifr.parse(buffer, { pick: ["DateTimeOriginal"] });
    return exifData?.DateTimeOriginal instanceof Date ? exifData.DateTimeOriginal : null;
  } catch {
    // Unreadable/corrupt EXIF segment — fall through to mtime.
    return null;
  }
}

/**
 * Builds the full/thumb/blur renditions.
 *
 * `.rotate()` with no arguments bakes in the EXIF orientation tag so the pixels are physically
 * upright, then drops the tag since it's no longer needed. sharp does not copy EXIF/IPTC/XMP
 * metadata to the output unless you call `.withMetadata()`, which we never do — so GPS and
 * everything else in the original's metadata is stripped by default, not as an extra step.
 * @param {Buffer} buffer
 */
export async function renderImage(buffer) {
  const full = await sharp(buffer, { failOn: "none" })
    .rotate()
    .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true, progressive: true })
    .toBuffer({ resolveWithObject: true });

  const thumb = await sharp(buffer, { failOn: "none" })
    .rotate()
    .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78, progressive: true })
    .toBuffer({ resolveWithObject: true });

  const blurBuf = await sharp(buffer, { failOn: "none" })
    .rotate()
    .resize({ width: 20 })
    .jpeg({ quality: 40 })
    .toBuffer();

  return {
    full: { buffer: full.data, width: full.info.width, height: full.info.height },
    thumb: { buffer: thumb.data, width: thumb.info.width, height: thumb.info.height },
    blur: `data:image/jpeg;base64,${blurBuf.toString("base64")}`,
    blurBytes: blurBuf.length,
  };
}

/**
 * Merge: new entries replace any existing entry sharing the same id. Sort newest first;
 * same-date entries break ties by id so `-2`/`-3` order is stable across runs.
 * @param {Photo[]} existingPhotos
 * @param {Photo[]} newPhotos
 * @returns {Photo[]}
 */
export function mergePhotos(existingPhotos, newPhotos) {
  const byId = new Map(existingPhotos.map((p) => [p.id, p]));
  for (const photo of newPhotos) byId.set(photo.id, photo);
  return [...byId.values()].sort(
    (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
  );
}

/**
 * @param {number} version
 * @param {Photo[]} photos
 * @returns {Manifest}
 */
export function buildManifest(version, photos) {
  return { version, updatedAt: new Date().toISOString(), photos };
}
