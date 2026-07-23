/**
 * Data layer.
 *
 * Everything the UI knows about photos comes through this module. Today the
 * only source is a manifest.json sitting next to the images in object storage.
 * When this becomes multi-user, add a source backed by a real database and swap
 * `source` below — no page or component needs to change.
 */

export type Photo = {
  /** Stable, URL-safe. Usually the date; `-2`, `-3` suffixes for extra shots. */
  id: string;
  /** YYYY-MM-DD. The day this photo *counts for*, which may not be the day it was taken. */
  date: string;
  caption?: string;
  /** Description for screen readers. Falls back to caption, then to the date. */
  alt?: string;
  width: number;
  height: number;
  /** Absolute URLs. */
  full: string;
  thumb: string;
  /** Tiny inline data URI used as a placeholder while the full image loads. */
  blur?: string;
  /** ISO datetime from EXIF, when available. */
  takenAt?: string;
};

export type Manifest = {
  version: number;
  updatedAt: string;
  photos: Photo[];
};

export interface PhotoSource {
  /** Newest first. */
  list(): Promise<Photo[]>;
}

/**
 * Reads the manifest published alongside the images.
 *
 * Deliberately knows nothing about which object store is behind `baseUrl` — it
 * only needs public HTTP. That's why switching between Cloudflare R2, AWS S3,
 * or a CDN in front of either is a PHOTOS_BASE_URL change and nothing more.
 */
class HttpManifestSource implements PhotoSource {
  constructor(private baseUrl: string) {}

  async list(): Promise<Photo[]> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/manifest.json`;

    const res = await fetch(url, {
      // New uploads appear within 5 minutes with no redeploy.
      next: { revalidate: 300 },
    });

    // A missing manifest is the normal state of a freshly-created bucket, not a
    // failure — the first upload creates it. Treat it as "no photos yet" so the
    // site renders its empty state instead of an error page. Anything else
    // (403, 500, network) is a real problem worth surfacing loudly.
    if (res.status === 404) return [];

    if (!res.ok) {
      throw new Error(`Could not read the photo manifest (${res.status} from ${url})`);
    }

    const manifest = (await res.json()) as Manifest;
    return [...manifest.photos].sort((a, b) => b.date.localeCompare(a.date));
  }
}

/** Used when PHOTOS_BASE_URL isn't set, so the site still renders locally. */
class EmptySource implements PhotoSource {
  async list(): Promise<Photo[]> {
    return [];
  }
}

const baseUrl = process.env.PHOTOS_BASE_URL;
const source: PhotoSource = baseUrl ? new HttpManifestSource(baseUrl) : new EmptySource();

export const isConfigured = Boolean(baseUrl);

export async function getPhotos(): Promise<Photo[]> {
  return source.list();
}

export async function getLatestPhoto(): Promise<Photo | null> {
  const photos = await getPhotos();
  return photos[0] ?? null;
}

export async function getPhoto(id: string): Promise<Photo | null> {
  const photos = await getPhotos();
  return photos.find((p) => p.id === id) ?? null;
}

/**
 * Neighbours in chronological order, for prev/next navigation.
 * `previous` is older, `next` is newer — both null at the ends.
 */
export async function getNeighbours(
  id: string,
): Promise<{ previous: Photo | null; next: Photo | null }> {
  const photos = await getPhotos(); // newest first
  const i = photos.findIndex((p) => p.id === id);
  if (i === -1) return { previous: null, next: null };
  return { previous: photos[i + 1] ?? null, next: photos[i - 1] ?? null };
}

/* -------------------------------------------------------------------------- */
/* Streaks                                                                     */
/* -------------------------------------------------------------------------- */

export type Streak = {
  /** Consecutive days up to today. Still counts if today isn't posted yet. */
  current: number;
  longest: number;
  /** Distinct days with at least one photo. */
  totalDays: number;
  totalPhotos: number;
  /** True once today has a photo — drives the "posted today" state. */
  postedToday: boolean;
};

const DAY_MS = 86_400_000;

/** Parsed as UTC so the result never shifts with the viewer's timezone. */
function toUTC(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * A streak is unbroken while each day follows the previous one. The current
 * streak is measured back from today, but starting at yesterday is still
 * "current" — you haven't broken anything until a full day has passed.
 */
export function computeStreak(photos: Photo[], today = todayUTC()): Streak {
  if (photos.length === 0) {
    return { current: 0, longest: 0, totalDays: 0, totalPhotos: 0, postedToday: false };
  }

  const days = [...new Set(photos.map((p) => p.date))].sort().reverse(); // newest first
  const todayMs = toUTC(today);
  const postedToday = days[0] === today;

  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    if (toUTC(days[i - 1]) - toUTC(days[i]) === DAY_MS) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }

  // Anything older than yesterday means the streak is already broken.
  const gap = todayMs - toUTC(days[0]);
  let current = 0;
  if (gap === 0 || gap === DAY_MS) {
    current = 1;
    for (let i = 1; i < days.length; i++) {
      if (toUTC(days[i - 1]) - toUTC(days[i]) === DAY_MS) current++;
      else break;
    }
  }

  return {
    current,
    longest,
    totalDays: days.length,
    totalPhotos: photos.length,
    postedToday,
  };
}

export async function getStreak(): Promise<Streak> {
  return computeStreak(await getPhotos());
}

/** Instant film ships in packs of 8 exposures — the streak is drawn in packs. */
export const PACK_SIZE = 8;

export function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateShort(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}
