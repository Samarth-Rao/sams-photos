/**
 * All R2/S3 I/O: config resolution, client construction, and reads/writes of
 * the manifest and image renditions. Kept separate from `./photo-pipeline.mjs`
 * so the pure rendering/merging logic can be tested and reused without a
 * network dependency.
 *
 * Storage is any S3-compatible object store. Today that's Cloudflare R2; the
 * exact same code runs unchanged against AWS S3 (or Backblaze B2, Supabase,
 * ...). `S3_ENDPOINT` is the only switch — set it for a compatible provider,
 * leave it unset for real AWS.
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

/** @typedef {{ bucket: string, region: string, endpoint?: string, accessKeyId?: string, secretAccessKey?: string, baseUrl: string }} StorageConfig */

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} name
 */
function requireEnv(env, name) {
  const value = env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}.\n` +
        `  Set it in .env.local (copy .env.example to get started), or export it in your shell.`,
    );
  }
  return value;
}

/**
 * Reads storage config out of an env object (typically `process.env`), applying the same
 * validation the CLI has always enforced.
 * @param {Record<string, string | undefined>} env
 * @returns {StorageConfig}
 */
export function resolveStorageConfig(env) {
  const bucket = requireEnv(env, "S3_BUCKET");
  const region = requireEnv(env, "S3_REGION");
  const baseUrl = requireEnv(env, "PHOTOS_BASE_URL").replace(/\/$/, "");

  // Unset means AWS S3; set means an S3-compatible provider (R2, B2, Supabase, ...).
  const endpoint = env.S3_ENDPOINT;

  // A half-configured key pair silently falls back to the AWS credential chain and then
  // fails with a confusing "no credentials" error, so catch it here instead.
  const accessKeyId = env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error(
      "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together.\n" +
        "  Set both (S3-compatible providers like R2), or neither (AWS S3, which uses the\n" +
        "  default credential chain — AWS_PROFILE, ~/.aws/credentials, etc).",
    );
  }

  return { bucket, region, endpoint, accessKeyId, secretAccessKey, baseUrl };
}

/**
 * @param {StorageConfig} config
 */
export function createStorageClient(config) {
  // Omitting `credentials` entirely (rather than passing undefined fields) is what lets the
  // SDK fall back to its default chain — AWS_PROFILE, plain env vars, ~/.aws/credentials, or
  // an instance role. Same for `endpoint`: absent means "use the real AWS endpoint".
  return new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    ...(config.accessKeyId
      ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }
      : {}),
  });
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Downloads manifest.json from the bucket; a missing manifest just means "no photos yet". */
export async function loadManifest(s3, bucket) {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: "manifest.json" }));
    const buf = await streamToBuffer(res.Body);
    return JSON.parse(buf.toString("utf8"));
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return { version: 1, updatedAt: new Date().toISOString(), photos: [] };
    }
    throw err;
  }
}

export async function saveManifest(s3, bucket, manifest) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: "manifest.json",
      Body: JSON.stringify(manifest, null, 2),
      ContentType: "application/json",
      CacheControl: "public, max-age=60, must-revalidate",
    }),
  );
}

/**
 * @param {string} key
 * @param {Buffer} buffer
 */
export async function putRendition(s3, bucket, key, buffer) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

/** @param {string} id */
export function photoKeys(id) {
  return { fullKey: `photos/${id}/full.jpg`, thumbKey: `photos/${id}/thumb.jpg` };
}
