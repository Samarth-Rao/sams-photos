# sam's polaroids

A daily photography practice. One photo a day, stored in object storage, shown as
a print on the front page with the whole archive underneath it.

## How it works

There is no server and no database. The pieces:

| Piece | Where it lives | What it does |
| --- | --- | --- |
| Photos | Bucket, `photos/<id>/full.jpg` and `thumb.jpg` | The images themselves, resized at upload time |
| Index | Bucket, `manifest.json` | One JSON file listing every photo with its date, caption, and dimensions |
| Site | This repo, deployed from git | Reads `manifest.json` on the server and renders it |
| Upload | `scripts/upload.mjs`, run locally | Resizes, strips EXIF, uploads, rewrites the manifest |

The site refetches the manifest every 5 minutes, so a new upload appears without
a redeploy.

### Storage is swappable

The bucket is **Cloudflare R2** today, but nothing is tied to it. The upload
script speaks the S3 API, so any S3-compatible store works, and the site only
ever does an HTTP `GET` against `PHOTOS_BASE_URL` — it has no storage SDK at
all. Moving to AWS S3 is an `.env.local` change, not a code change; see the last
section of `docs/R2-SETUP.md`.

## Setup

1. Follow `docs/R2-SETUP.md` to create the bucket and a scoped API token. Do this
   once. (Using AWS S3 instead? `docs/S3-SETUP.md`.)
2. Copy `.env.example` to `.env.local` and fill it in.
3. `npm install && npm run dev`

## Posting a photo

Two ways in, one pipeline behind them. Both share
`src/lib/photo-pipeline.mjs`, so a photo posted from your phone is
byte-for-byte what the CLI would have produced.

### From the web — `/upload`

Password-protected. Drag a JPEG onto the page from your desktop, or open it on
your phone and shoot straight into it. Needs `UPLOAD_PASSWORD`, `AUTH_SECRET`,
and an R2 CORS policy — see `docs/WEB-UPLOAD.md`.

The browser uploads directly to R2 with a presigned URL, so image bytes never
pass through the server and platform request-body limits (Vercel's ~4.5MB)
never apply.

### From the terminal

```bash
npm run upload -- ~/Pictures/DSC_0431.jpg --caption "Low tide, Whitstable"
```

The day it counts for comes from the photo's EXIF capture date. Override it with
`--date 2026-07-14` to fill in a day you missed — which is how one day out with
several shots covers off a quiet week. Extra photos on a day already taken get
`-2`, `-3` ids automatically.

Pass `--dry-run` to see what would happen without uploading anything.

## Layout

```
src/lib/photos.ts          Data layer — the only thing that knows where photos come from
src/lib/photo-pipeline.mjs Rendering, ids, EXIF, manifest merging — shared by web + CLI
src/lib/storage.mjs        All R2/S3 I/O — the only storage-aware module
src/lib/auth.ts            Password check + signed session cookie
src/app/page.tsx           Hero print, streak, archive grid
src/app/photo/[id]/        A single frame
src/app/upload/            The web uploader
src/app/api/upload/        sign (presign) + process (render & publish)
scripts/upload.mjs         The upload CLI
docs/WEB-UPLOAD.md         Setting up /upload
docs/R2-SETUP.md           One-time Cloudflare R2 setup (current)
docs/S3-SETUP.md           One-time AWS S3 setup (the swap target)
```

`photo-pipeline.mjs` and `storage.mjs` are plain `.mjs` rather than TypeScript
so that both the Next app and `node scripts/upload.mjs` can import them without
a build step.

## If this becomes multi-user

The groundwork is the `PhotoSource` interface in `src/lib/photos.ts`. Every page
reads photos through it, so adding accounts means writing a database-backed
source and swapping the one line that picks the implementation — no page or
component changes.

The parts that would still need building: authentication, a per-user manifest key
or table, and browser-side uploads via presigned URLs so nobody needs storage
credentials on their machine (R2 and S3 both support these, unchanged). Streak logic in `computeStreak` is already pure and
takes a photo list, so it works per-user unchanged.
