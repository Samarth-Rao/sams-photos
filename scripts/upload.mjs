#!/usr/bin/env node
/**
 * Daily upload CLI for sam's polaroids.
 *
 * Usage:
 *   npm run upload -- <file...> [--date YYYY-MM-DD] [--caption "text"] [--alt "text"] [--dry-run]
 *
 * For each input file:
 *   1. Figures out which day it counts for (--date, else EXIF DateTimeOriginal, else the
 *      file's mtime).
 *   2. Assigns an id — the date, or <date>-2, <date>-3, ... if that day already has a photo
 *      (either already in the manifest, or earlier in this same batch).
 *   3. Derives full/thumb/blur renditions with sharp. All are auto-rotated to respect EXIF
 *      orientation and stripped of EXIF (sharp does this by default unless you ask it to keep
 *      metadata) — no GPS ships with the uploaded images.
 *   4. Uploads full.jpg and thumb.jpg to S3.
 *   5. Merges the new entries into manifest.json (downloaded from S3, or a fresh one if this
 *      is the first upload) and writes it back.
 *
 * Storage is any S3-compatible object store. Today that's Cloudflare R2; the exact same code
 * runs unchanged against AWS S3 (or Backblaze B2, Supabase, ...). `S3_ENDPOINT` is the only
 * switch — set it for a compatible provider, leave it unset for real AWS.
 *
 * Config comes from .env.local (see .env.example). Credentials work one of two ways:
 * S3-compatible providers issue an explicit key pair (S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY),
 * since they have no equivalent of the AWS credential chain. Leave both unset and the SDK
 * falls back to that chain (AWS_PROFILE, environment variables, ~/.aws/credentials, an
 * instance role) — which is how you'd run this against AWS S3.
 *
 * The actual rendering/merging logic lives in `src/lib/photo-pipeline.mjs` and the S3 I/O in
 * `src/lib/storage.mjs` — both plain .mjs so a Next.js route handler can import them too
 * without duplicating this CLI's behaviour.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import dotenv from "dotenv";

import {
  isValidDate,
  formatDateLocal,
  assignId,
  readExifDate,
  renderImage,
  mergePhotos,
  buildManifest,
  MAX_BLUR_BYTES,
} from "../src/lib/photo-pipeline.mjs";
import {
  resolveStorageConfig,
  createStorageClient,
  loadManifest,
  saveManifest,
  putRendition,
  photoKeys,
} from "../src/lib/storage.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Load .env.local specifically (not the default .env) — doesn't override already-exported
// shell variables, so `AWS_PROFILE=x npm run upload` still wins over a value in the file.
// `quiet` silences dotenv's promotional banner so it doesn't clutter our own output.
dotenv.config({ path: path.join(ROOT, ".env.local"), quiet: true });

const HELP = `
Usage: npm run upload -- <file...> [options]

Uploads one or more photos: generates full/thumb/blur renditions and updates
the public manifest.json.

Options:
  --date YYYY-MM-DD    Day this photo counts for. Defaults to the EXIF
                        DateTimeOriginal, then the file's last-modified time.
  --caption "text"      Caption applied to every file in this run.
  --alt "text"          Alt text applied to every file in this run.
  --dry-run             Process everything, including reading the current
                         manifest from S3, but upload nothing.
  -h, --help             Show this help.

Required environment (.env.local — see .env.example):
  S3_BUCKET             Bucket name.
  S3_REGION             Region the bucket lives in. Use "auto" for Cloudflare R2.
  PHOTOS_BASE_URL       Public base URL photos are served from (no trailing slash).

Optional environment:
  S3_ENDPOINT           S3-compatible API endpoint, e.g.
                         https://<account-id>.r2.cloudflarestorage.com for R2.
                         Leave unset to talk to AWS S3.
  S3_ACCESS_KEY_ID      Explicit key pair, required by S3-compatible providers.
  S3_SECRET_ACCESS_KEY  If both are unset, credentials come from the default AWS
                         credential chain (AWS_PROFILE, ~/.aws/credentials) instead.

Setup: docs/R2-SETUP.md for Cloudflare R2, docs/S3-SETUP.md for AWS S3.

Examples:
  npm run upload -- photo.jpg
  npm run upload -- IMG_001.jpg IMG_002.jpg --caption "Beach day"
  npm run upload -- old-scan.jpg --date 2024-03-01 --dry-run
`;

function parseArgs(argv) {
  const files = [];
  const opts = { date: null, caption: null, alt: null, dryRun: false, help: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        opts.help = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--date":
        opts.date = argv[++i];
        break;
      case "--caption":
        opts.caption = argv[++i];
        break;
      case "--alt":
        opts.alt = argv[++i];
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown flag: ${arg}. Run with --help to see usage.`);
        }
        files.push(arg);
    }
  }
  return { files, opts };
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

/** Which calendar day a file counts for, and where that decision came from. */
async function determineDate(file, dateFlag, takenAt) {
  if (dateFlag) return { date: dateFlag, source: "--date" };
  if (takenAt instanceof Date) {
    return { date: formatDateLocal(takenAt), source: "EXIF" };
  }
  const stat = await fs.stat(file);
  return { date: formatDateLocal(stat.mtime), source: "file mtime" };
}

async function main() {
  const { files, opts } = parseArgs(process.argv.slice(2));

  if (opts.help || files.length === 0) {
    console.log(HELP);
    process.exit(opts.help ? 0 : 1);
  }

  if (opts.date && !isValidDate(opts.date)) {
    fail(`--date must be in YYYY-MM-DD format, got "${opts.date}".`);
  }

  // Resolving config can throw (missing var, half-set key pair) — that propagates out of
  // main() to the .catch() below, which reports it exactly like the fail() calls elsewhere.
  const config = resolveStorageConfig(process.env);

  // Confirm every file exists before doing any work (renders, uploads, ...).
  for (const file of files) {
    try {
      await fs.access(file);
    } catch {
      fail(`File not found: ${file}`);
    }
  }

  const s3 = createStorageClient(config);

  console.log(`Storage: ${config.endpoint ?? "AWS S3"} — bucket "${config.bucket}" (${config.region})`);
  if (opts.dryRun) console.log("Dry run — no uploads will happen.\n");

  console.log("Reading existing manifest...");
  const manifest = await loadManifest(s3, config.bucket);
  const idsInUse = new Set(manifest.photos.map((p) => p.id));
  console.log(`Found ${manifest.photos.length} existing photo(s) in the manifest.\n`);

  const newPhotos = [];

  for (const file of files) {
    const name = path.basename(file);
    console.log(`Processing ${name}`);

    const buffer = await fs.readFile(file);
    const takenAt = await readExifDate(buffer);

    const { date, source } = await determineDate(file, opts.date, takenAt);
    const id = assignId(date, idsInUse);
    idsInUse.add(id);

    const rendered = await renderImage(buffer);

    console.log(`  date: ${date} (from ${source})`);
    console.log(`  id: ${id}`);
    console.log(
      `  full:  ${rendered.full.width}x${rendered.full.height}, ${formatBytes(rendered.full.buffer.length)}`,
    );
    console.log(
      `  thumb: ${rendered.thumb.width}x${rendered.thumb.height}, ${formatBytes(rendered.thumb.buffer.length)}`,
    );
    console.log(`  blur:  ${rendered.blurBytes} bytes`);
    if (rendered.blurBytes > MAX_BLUR_BYTES) {
      console.log(`  warning: blur placeholder exceeds the ~1.5KB target`);
    }

    const { fullKey, thumbKey } = photoKeys(id);

    if (opts.dryRun) {
      console.log(`  [dry-run] would upload s3://${config.bucket}/${fullKey}`);
      console.log(`  [dry-run] would upload s3://${config.bucket}/${thumbKey}`);
    } else {
      await putRendition(s3, config.bucket, fullKey, rendered.full.buffer);
      await putRendition(s3, config.bucket, thumbKey, rendered.thumb.buffer);
      console.log(`  uploaded to s3://${config.bucket}/photos/${id}/`);
    }

    newPhotos.push({
      id,
      date,
      ...(opts.caption ? { caption: opts.caption } : {}),
      ...(opts.alt ? { alt: opts.alt } : {}),
      width: rendered.full.width,
      height: rendered.full.height,
      full: `${config.baseUrl}/${fullKey}`,
      thumb: `${config.baseUrl}/${thumbKey}`,
      blur: rendered.blur,
      ...(takenAt instanceof Date ? { takenAt: takenAt.toISOString() } : {}),
    });

    console.log("");
  }

  const photos = mergePhotos(manifest.photos, newPhotos);
  const updatedManifest = buildManifest(manifest.version ?? 1, photos);

  if (opts.dryRun) {
    console.log(`[dry-run] would upload manifest.json (${photos.length} photo(s) total)`);
  } else {
    console.log("Uploading manifest.json...");
    await saveManifest(s3, config.bucket, updatedManifest);
  }

  console.log("");
  console.log(
    `${opts.dryRun ? "[dry-run] " : ""}Done — ${newPhotos.length} photo(s) processed, ${photos.length} total in manifest.`,
  );
  console.log(`Manifest: ${config.baseUrl}/manifest.json`);
}

main().catch((err) => {
  fail(err?.message ?? String(err));
});
