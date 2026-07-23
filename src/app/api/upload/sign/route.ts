import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireAuth } from "@/lib/auth";
import { resolveStorageConfig, createStorageClient } from "@/lib/storage.mjs";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const PRESIGN_EXPIRY_SEC = 300;

// sharp in this deployment has no HEVC codec, so HEIC/HEIF genuinely can't be decoded — call
// that out by name here rather than letting it through to fail confusingly in /process.
const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

type SignBody = {
  filename?: unknown;
  contentType?: unknown;
  size?: unknown;
};

export async function POST(request: Request) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  let body: SignBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const { contentType, size } = body;

  if (typeof contentType !== "string" || !(contentType in CONTENT_TYPE_EXTENSIONS)) {
    const message =
      contentType === "image/heic" || contentType === "image/heif"
        ? `HEIC/HEIF images aren't supported — this server's sharp build has no HEVC codec and can't decode them. Please convert to JPEG before uploading.`
        : `Unsupported content type "${String(contentType)}". Allowed types: ${Object.keys(CONTENT_TYPE_EXTENSIONS).join(", ")}.`;
    return Response.json({ error: message }, { status: 400 });
  }

  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0 || size > MAX_UPLOAD_BYTES) {
    return Response.json(
      { error: `File size must be between 1 byte and ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.` },
      { status: 400 },
    );
  }

  // Extension comes from the validated content type, never from the user-supplied filename —
  // the filename is untrusted and only used for display, never for building a storage key.
  const ext = CONTENT_TYPE_EXTENSIONS[contentType];
  const key = `staging/${randomUUID()}.${ext}`;

  try {
    const config = resolveStorageConfig(process.env);
    const s3 = createStorageClient(config);

    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: config.bucket, Key: key, ContentType: contentType }),
      { expiresIn: PRESIGN_EXPIRY_SEC },
    );

    return Response.json({ key, url, expiresInSec: PRESIGN_EXPIRY_SEC });
  } catch (err) {
    console.error("Failed to presign upload URL:", err);
    return Response.json({ error: "Could not prepare an upload URL." }, { status: 500 });
  }
}
