# Posting from the web (`/upload`)

`npm run upload` needs your laptop, your terminal, and the R2 credentials on
disk. `/upload` is the same pipeline behind a password, so you can post from a
phone straight after taking the shot, or drag a JPEG onto the page after
editing something from the camera.

Both routes share the same code — `src/lib/photo-pipeline.mjs` and
`src/lib/storage.mjs` — so a photo posted from the web is byte-for-byte what
the CLI would have produced. There is no second pipeline to drift out of sync.

---

## 1. Configure the two secrets

Add to `.env.local` (see `.env.example`):

```bash
UPLOAD_PASSWORD=<something long>
AUTH_SECRET=<long random string>
```

Generate the secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`UPLOAD_PASSWORD` is what you type at `/upload`. `AUTH_SECRET` signs the
session cookie — changing it logs out every session immediately.

If either is missing, `/upload` refuses to authenticate anyone. That's
deliberate: an endpoint that writes to your real bucket should fail closed, not
open.

When you deploy, set both in your host's environment variable settings too —
`.env.local` is gitignored and never ships.

---

## 2. Configure R2 CORS

**Required.** The browser uploads *directly* to R2, so R2 must accept
cross-origin `PUT`s from your site. Without this, uploads fail in the browser
with an opaque CORS error while `curl` keeps working — a genuinely confusing
combination, so do this before testing.

Cloudflare dashboard → **R2** → your bucket → **Settings** → **CORS Policy** →
**Add CORS policy**:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://your-production-domain.com"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Every origin you upload *from* must be listed. Add your production domain
before your first deploy, or uploads will work locally and fail in production.

> This can't be scripted with the project's R2 token — that token is scoped to
> **Object Read & Write**, and bucket configuration needs **Admin Read &
> Write**. That's the scoping working as intended; do it in the dashboard
> rather than widening the token.

---

## 3. How it works

```
POST /api/upload/sign      auth → validate type + size
                           → presigned PUT URL for staging/<uuid>.<ext> (5 min)

Browser PUT → R2           the file goes straight to R2, never through
                           the server

POST /api/upload/process   auth → validate key → pull from R2 → sharp
                           (full/thumb/blur, EXIF stripped) → assign id
                           → merge manifest → delete staged original
```

The reason for the detour: image bytes never pass through the serverless
function, so **platform request-body limits never apply**. Vercel caps function
request bodies at ~4.5MB, which a camera JPEG blows straight past. Uploading
direct to R2 sidesteps that entirely — R2 accepts up to 5GB in a single PUT —
with no chunking or resumable-upload machinery to maintain.

The staged original is deleted once the renditions are published, so it only
exists for the seconds between upload and processing. Originals are never kept
(see the note in `docs/R2-SETUP.md` — they'd carry GPS EXIF and must never sit
under the public `photos/` prefix).

---

## 4. Security model

| Layer | What it does |
| --- | --- |
| Password | Compared in constant time against `UPLOAD_PASSWORD`. Both sides are SHA-256'd first so the comparison never leaks length. |
| Session | HttpOnly, Secure, SameSite=Strict cookie holding `<expiry>.<HMAC>`, signed with `AUTH_SECRET`. 30-day TTL. |
| Rate limit | 5 failed attempts per IP per 15 minutes. **In-memory, so it does not survive across serverless instances** — defence-in-depth against casual guessing, not a hard guarantee. |
| Route guard | Every upload route calls `requireAuth()` itself. Next's own docs warn that `proxy.ts` (formerly `middleware.ts`) "should not be used as a full session management or authorization solution", so the check lives in the handler where it can't be bypassed. |
| Key validation | `/process` only accepts keys matching `staging/<uuid>.<ext>`. Without this an authenticated caller could point the processor at arbitrary objects. |
| Presign scope | Signed URLs are `PutObject` only, for one exact key and content type, expiring in 5 minutes. |

The password is the whole security boundary. Make it long.

---

## 5. HEIC — the one real limitation

**iPhone's default photo format cannot be decoded by this project's `sharp`
build.** The bundled libvips has libheif but no HEVC codec, so real HEIC files
fail to decode. (AVIF, its AV1-based sibling, works fine.)

This is handled in three layers rather than a flat rejection:

1. The file picker's `accept` list excludes HEIC, and **iOS Safari transcodes
   HEIC→JPEG automatically** when it does. This is why posting from your iPhone
   works without any conversion step — the common path never sees a HEIC.
2. Drag-and-drop bypasses `accept`, so dropped files are sniffed by magic bytes
   (the `ftyp` box), not by extension or `file.type` — both of which lie, and
   drag-drop frequently reports an empty type.
3. A detected HEIC is converted in the browser by a lazily-imported wasm
   decoder, so nothing is downloaded unless a HEIC actually appears.

If conversion fails, the error names HEIC explicitly and tells you to re-export
as JPEG. The server also rejects HEIC at `/sign` with the same explanation, so
a failure is never mysterious.

To remove the limitation properly you'd need a `sharp`/libvips build with an
HEVC decoder, which the prebuilt binaries deliberately omit for patent reasons.

---

## 6. Other limits

- **50MB** per file, enforced at `/sign` before any bytes move.
- Accepted: `image/jpeg`, `image/png`, `image/webp`, `image/avif`.
- **Uploads are processed one at a time.** `manifest.json` is read-modify-write,
  so two simultaneous `/process` calls would race and lose an entry. The UI
  serialises them. This is a real constraint, not an oversight — a locking
  scheme isn't worth it for a single-user site.
- A photo posted for a day that already has one gets `-2`, `-3` — same rule as
  the CLI.

---

## 7. Troubleshooting

| Symptom | Cause |
| --- | --- |
| `/upload` says auth isn't configured | `UPLOAD_PASSWORD` or `AUTH_SECRET` missing from the environment. In production, set them in your host's env settings, not `.env.local`. |
| Login works, upload fails with a CORS error | R2 CORS policy missing this origin (step 2). `curl` will still work — CORS is browser-only, which is what makes this confusing. |
| Upload fails only in production | Production domain not in `AllowedOrigins`. |
| "could not decode" on an iPhone photo | A HEIC got through. Re-export as JPEG, or check the `accept` list is reaching Safari. |
| Photo published but the site still looks stale | `manifest.json` is cached 60s at the edge and the app revalidates every 300s. `/process` calls `revalidatePath` so it should be immediate — if not, wait a minute. |
| 429 on login | Rate limit: 5 failed attempts per 15 minutes. |
