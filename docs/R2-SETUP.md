# Cloudflare R2 setup for sam's polaroids

One-time setup so `npm run upload` has somewhere to put photos, and the
Next.js app has a `PHOTOS_BASE_URL` to read them from.

R2 is an S3-compatible object store, which is the whole reason it's a drop-in
here: `scripts/upload.mjs` talks to it through the same `@aws-sdk/client-s3`
it uses for AWS. Nothing in the app knows or cares which one is behind the
URL. If you later move to AWS S3, follow `docs/S3-SETUP.md` and change
`.env.local` — there is no code to rewrite.

Throughout, replace `BUCKET_NAME` with your bucket (`sams-polaroids`) and
`ACCOUNT_ID` with your Cloudflare account ID.

---

## 1. The bucket

Cloudflare dashboard → **R2** → **Create bucket**, if you haven't already.
Unlike S3, R2 bucket names only need to be unique **within your account**, not
globally — so `sams-polaroids` is fine as-is.

**Location**: leave it on **Automatic** unless you have a reason not to. R2
has no per-region pricing difference, and egress is free everywhere, so the
only effect is latency on writes.

**You do not need to configure a region anywhere.** R2 ignores it. The AWS SDK
still demands the field exist, which is why `.env.local` sets
`S3_REGION=auto` — that's Cloudflare's documented placeholder value, not a
real region.

---

## 2. Find your account ID and endpoint

R2 → **Overview**. The right-hand sidebar shows **Account ID**, and the page
shows the **S3 API** endpoint, which looks like:

```
https://ACCOUNT_ID.r2.cloudflarestorage.com
```

That full URL is your `S3_ENDPOINT`. Note there's no bucket name in it — the
bucket is passed separately by the SDK, exactly as with AWS.

---

## 3. Make the bucket publicly readable

R2 buckets are **private by default**. Photos and `manifest.json` have to be
publicly readable over HTTPS or the site can't display anything. There are two
ways, and the choice only affects what you put in `PHOTOS_BASE_URL`.

### Option A: r2.dev development URL (fastest)

Bucket → **Settings** → **Public Development URL** → **Enable**, then confirm
by typing `allow`.

You get a URL like `https://pub-xxxxxxxxxxxx.r2.dev`. That's your
`PHOTOS_BASE_URL`.

> **Cloudflare's own caveat**: the `r2.dev` subdomain is **rate-limited and
> intended for development only**. It also bypasses Cloudflare's cache and
> can't use WAF or bot management. It's genuinely fine for getting running
> today and for a site only you look at, but don't leave a real audience on
> it. Pointing a CNAME at an `r2.dev` URL is explicitly unsupported — use
> option B instead.

### Option B: custom domain (preferred once you have a domain)

Requires a domain already added to your Cloudflare account as a zone.

Bucket → **Settings** → **Custom Domains** → **Connect Domain** → enter e.g.
`photos.yourdomain.com`. Cloudflare creates the DNS record for you.

This routes through Cloudflare's CDN, so objects are cached at the edge and
the rate limit goes away. Your `PHOTOS_BASE_URL` becomes
`https://photos.yourdomain.com`.

Caching works without any extra configuration: `upload.mjs` already sets
`Cache-Control: public, max-age=31536000, immutable` on images and
`max-age=60, must-revalidate` on `manifest.json`, and Cloudflare honours
both. Images are never overwritten (each `id` is permanent), and the
manifest's short max-age means new uploads show up on their own within about
a minute — no cache purge needed.

### What you do *not* need

**CORS configuration.** A common R2 stumbling block, but irrelevant here: the
manifest is fetched server-side by a Next.js Server Component, and the images
are loaded by plain `<img>` tags. Neither is a cross-origin browser fetch, so
there is nothing to allow. If you later add client-side `fetch()` of the
manifest or canvas-based image processing, revisit this.

---

## 4. Create a scoped API token

Don't reuse a global Cloudflare key. Make a token that can only touch this
bucket, mirroring the narrow IAM user in the S3 setup.

R2 → **Manage API Tokens** (top-right of the R2 overview page) → **Create API
Token**.

1. **Token name**: something like `polaroids-uploader`.
2. **Permissions**: choose **Object Read & Write**. The upload script needs
   read (it downloads `manifest.json` to merge into it) and write (images plus
   the rewritten manifest). It never needs **Admin** — that tier is for
   creating and deleting buckets, which the script doesn't do.
3. **Specify bucket(s)**: select **Apply to specific buckets only** and pick
   `sams-polaroids`. This is the part that makes the token narrow — skip it
   and the token can read and write every bucket in the account.
4. **TTL**: leave as **Forever** unless you want to rotate on a schedule.
5. **Create API Token**.

The result page shows an **Access Key ID** and a **Secret Access Key**. These
are what go in `.env.local` as `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`.

**Copy the secret now** — like AWS, it's displayed exactly once. If you lose
it, delete the token and create a new one.

> Cloudflare also shows a "Token value" separate from the access key pair.
> That one is for Cloudflare's own API, **not** the S3-compatible endpoint —
> ignore it here.

---

## 5. `.env.local`

Copy `.env.example` to `.env.local` and fill in the R2 block. `.env.local` is
gitignored — it's never committed.

Worked example:

```bash
S3_BUCKET=sams-polaroids
S3_REGION=auto
S3_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=<access key id from step 4>
S3_SECRET_ACCESS_KEY=<secret access key from step 4>
PHOTOS_BASE_URL=https://pub-xxxxxxxxxxxx.r2.dev
```

Unlike the AWS setup, credentials **do** live in this file. R2 has no
equivalent of the AWS credential chain (no `~/.aws/credentials`, no
`AWS_PROFILE`, no instance roles), so an explicit key pair is the only option.
The upload script requires both keys together and will stop with a clear error
if only one is set.

---

## 6. Verify it works

Dry run first — this still reads the real manifest from R2, so it proves
credentials and endpoint are right, but uploads nothing:

```bash
npm run upload -- ~/Desktop/test-photo.jpg --dry-run
```

The first line of output confirms what it's talking to:

```
Storage: https://ACCOUNT_ID.r2.cloudflarestorage.com — bucket "sams-polaroids" (auto)
```

Then for real:

```bash
npm run upload -- ~/Desktop/test-photo.jpg
```

Confirm the manifest is publicly readable:

```bash
curl -s https://pub-xxxxxxxxxxxx.r2.dev/manifest.json
```

You should get JSON with your test photo in `photos`. Then check the image
itself, including headers:

```bash
curl -sI https://pub-xxxxxxxxxxxx.r2.dev/photos/<id>/full.jpg
```

Look for `HTTP/2 200`, `content-type: image/jpeg`, and `cache-control:
public, max-age=31536000, immutable`.

Finally, run the site:

```bash
npm run dev
```

### Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Missing required environment variable` | `.env.local` doesn't exist or the name is misspelled. It must be `.env.local`, not `.env`. |
| `InvalidAccessKeyId` / `SignatureDoesNotMatch` | Wrong key pair, or the secret got truncated on copy. Recreate the token. |
| `Access Denied` on upload | Token is **Object Read only**, or it's scoped to a different bucket. |
| `NoSuchBucket` | `S3_BUCKET` doesn't match the real name, or `S3_ENDPOINT` has the wrong account ID. |
| Upload works, but the site shows nothing | Public access isn't enabled (step 3), or `PHOTOS_BASE_URL` is wrong. Test with the `curl` above — if that 401s, it's step 3. |
| `curl` on the manifest returns 401 | The bucket is still private. Enable the public dev URL or connect a custom domain. |
| Site shows an old photo set | `manifest.json` is cached for 60s. Wait a minute. |

---

## 7. Moving to AWS S3 later

Nothing in `src/` or `scripts/` changes. In `.env.local`:

1. **Delete `S3_ENDPOINT`.** With it gone the SDK targets real AWS S3. This is
   the actual switch.
2. **Delete `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`**, and set up an
   `AWS_PROFILE` instead — the script falls back to the AWS credential chain
   when no explicit keys are present.
3. Set `S3_REGION` to a real region (`us-east-1`, not `auto`).
4. Point `PHOTOS_BASE_URL` at the S3 or CloudFront URL.

`docs/S3-SETUP.md` covers creating the bucket, its public-read policy, and the
scoped IAM user. Copy the existing objects across with `rclone` or by
re-running `npm run upload` on your originals — the manifest is rebuilt from
whatever's in the bucket's `manifest.json`, so a fresh upload starts clean.
