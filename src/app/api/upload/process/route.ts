import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import {
  isValidDate,
  formatDateLocal,
  assignId,
  readExifDate,
  renderImage,
  mergePhotos,
  buildManifest,
} from "@/lib/photo-pipeline.mjs";
import {
  resolveStorageConfig,
  createStorageClient,
  loadManifest,
  saveManifest,
  putRendition,
  photoKeys,
} from "@/lib/storage.mjs";
import type { Photo, Manifest } from "@/lib/photos";

const MAX_TEXT_LENGTH = 500;

// Staging keys are always minted by /api/upload/sign as `staging/<uuid>.<ext>`. Enforcing that
// exact shape here (rather than just checking the "staging/" prefix) is the security boundary:
// an authenticated caller who could pass an arbitrary key would make this route GET/DELETE
// objects it has no business touching (e.g. `manifest.json`, or another day's renditions).
const STAGING_KEY_RE = /^staging\/[0-9a-f-]{36}\.(jpg|png|webp|avif)$/;

type ProcessBody = {
  key?: unknown;
  date?: unknown;
  caption?: unknown;
  alt?: unknown;
};

function isNoSuchKeyError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}

export async function POST(request: Request) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  let body: ProcessBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const { key, date, caption, alt } = body;

  if (typeof key !== "string" || !STAGING_KEY_RE.test(key)) {
    return Response.json({ error: "Invalid or missing upload key." }, { status: 400 });
  }

  if (date !== undefined && (typeof date !== "string" || !isValidDate(date))) {
    return Response.json({ error: "date must be in YYYY-MM-DD format." }, { status: 400 });
  }
  if (caption !== undefined && (typeof caption !== "string" || caption.length > MAX_TEXT_LENGTH)) {
    return Response.json(
      { error: `caption must be a string of ${MAX_TEXT_LENGTH} characters or fewer.` },
      { status: 400 },
    );
  }
  if (alt !== undefined && (typeof alt !== "string" || alt.length > MAX_TEXT_LENGTH)) {
    return Response.json(
      { error: `alt must be a string of ${MAX_TEXT_LENGTH} characters or fewer.` },
      { status: 400 },
    );
  }

  let config;
  let s3;
  try {
    config = resolveStorageConfig(process.env);
    s3 = createStorageClient(config);
  } catch (err) {
    console.error("Storage config error:", err);
    return Response.json({ error: "Storage is not configured on the server." }, { status: 500 });
  }

  let buffer: Buffer;
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
    const bytes = await res.Body!.transformToByteArray();
    buffer = Buffer.from(bytes);
  } catch (err) {
    if (isNoSuchKeyError(err)) {
      return Response.json({ error: "Upload not found or expired." }, { status: 400 });
    }
    console.error("Failed to fetch staged upload:", err);
    return Response.json({ error: "Could not read the uploaded file." }, { status: 500 });
  }

  const takenAt = await readExifDate(buffer);

  // Unlike the CLI (which can fall back to a file's mtime), a route handler only ever sees
  // bytes — there's no filesystem entry to stat. So the fallback chain ends at "today" instead.
  const resolvedDate: string =
    (date as string | undefined) ?? (takenAt ? formatDateLocal(takenAt) : formatDateLocal(new Date()));

  // NOTE: this is a read-modify-write against a single manifest.json. Two /process requests
  // in flight at once can race and one's photo entry can be lost. The upload UI serializes
  // uploads to sidestep this; a real locking scheme is out of scope for a single-user site.
  const manifest: Manifest = await loadManifest(s3, config.bucket);
  const idsInUse = new Set(manifest.photos.map((p) => p.id));
  const id: string = assignId(resolvedDate, idsInUse);

  let rendered: Awaited<ReturnType<typeof renderImage>>;
  try {
    rendered = await renderImage(buffer);
  } catch (err) {
    console.error("Failed to decode uploaded image:", err);
    return Response.json(
      {
        error:
          "Could not decode this image — it may be corrupt or in an unsupported format. " +
          "HEIC/HEIF is the most likely cause (this server's sharp build can't decode it); " +
          "please supply a JPEG, PNG, WebP, or AVIF instead.",
      },
      { status: 415 },
    );
  }

  const { fullKey, thumbKey } = photoKeys(id);
  await putRendition(s3, config.bucket, fullKey, rendered.full.buffer);
  await putRendition(s3, config.bucket, thumbKey, rendered.thumb.buffer);

  const photo: Photo = {
    id,
    date: resolvedDate,
    ...(typeof caption === "string" ? { caption } : {}),
    ...(typeof alt === "string" ? { alt } : {}),
    width: rendered.full.width,
    height: rendered.full.height,
    full: `${config.baseUrl}/${fullKey}`,
    thumb: `${config.baseUrl}/${thumbKey}`,
    blur: rendered.blur,
    ...(takenAt ? { takenAt: takenAt.toISOString() } : {}),
  };

  const photos = mergePhotos(manifest.photos, [photo]);
  const updatedManifest = buildManifest(manifest.version ?? 1, photos);
  await saveManifest(s3, config.bucket, updatedManifest);

  // Best-effort cleanup. The photo is already published at this point — failing the request
  // over a leftover staging object would be strictly worse than just leaving it there for
  // whatever bucket lifecycle rule (or a human) to clean up later.
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  } catch (err) {
    console.error("Failed to delete staged upload (non-fatal):", err);
  }

  // The manifest itself is fetched with a 5-minute cache (see src/lib/photos.ts), so without
  // this the new photo wouldn't show up on the site for up to 300s after a successful publish.
  revalidatePath("/");
  revalidatePath("/photo/[id]", "page");

  return Response.json({ photo });
}
