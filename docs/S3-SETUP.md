# S3 setup for sam's polaroids

One-time setup so `npm run upload` has somewhere to put photos, and the
Next.js app has a `PHOTOS_BASE_URL` to read them from. You'll need the AWS
CLI (already installed) and an AWS account. Every step has both a console
version and a CLI version — pick whichever you're more comfortable with, you
don't need to do both.

Throughout this doc, replace:
- `BUCKET_NAME` with your actual bucket name
- `REGION` with your chosen AWS region, e.g. `us-east-1`

---

## 1. Create the bucket

**Bucket names are globally unique across all of AWS** — not just your
account. `polaroids` is certainly taken; something like
`sam-polaroids-photos` or `yourname-daily-photos-2026` will work. Stick to
lowercase letters, digits, and hyphens.

**Region**: pick whichever is geographically closest to you (e.g.
`us-east-1` for US East Coast, `eu-west-1` for Western Europe). It only
affects latency and, negligibly, cost — there's no wrong answer for a
personal project.

### Console

1. Go to the [S3 console](https://console.aws.amazon.com/s3/) → **Create bucket**.
2. **Bucket name**: your globally-unique name.
3. **AWS Region**: your chosen region.
4. **Object Ownership**: leave the default, **ACLs disabled**. This project
   uses a bucket policy for public access, not ACLs — that's the modern,
   recommended approach and needs no change here.
5. **Block Public Access settings for this bucket**: this is the part that
   trips people up, so read this carefully. There are 4 checkboxes grouped
   under one "Block all public access" master checkbox:
   - Block public access to buckets and objects granted through **new**
     access control lists (ACLs)
   - Block public access to buckets and objects granted through **any**
     access control lists (ACLs)
   - Block public access to buckets and objects granted through **new**
     public bucket or access point policies
   - Block public access to buckets and objects granted through **any**
     public bucket or access point policies

   Uncheck the master **"Block all public access"** checkbox to unlock the
   four, then set them like this:
   - Leave **both ACL-related boxes checked** (we never use ACLs, so
     blocking them costs nothing and is safer).
   - **Uncheck both policy-related boxes.** Our bucket policy (step 3 below)
     is a public *policy*, not an ACL, so these two must be off for it to
     take effect.

   This is the least-open configuration that still lets a bucket policy
   grant public reads.
6. **Bucket Versioning**: leave disabled — not needed here, and it would
   make old renditions linger in the bucket forever.
7. Everything else: defaults are fine. Click **Create bucket**.

> **Gotcha**: AWS accounts also have an *account-level* Block Public Access
> setting, separate from the per-bucket one, at **S3 console → Block Public
> Access settings for this account** (left sidebar). If that account-level
> setting still blocks public bucket policies, it silently overrides
> whatever you configured above. If step 3's policy doesn't seem to work,
> check there and uncheck the same two "policy" boxes.

### CLI equivalent

```bash
# For any region other than us-east-1:
aws s3api create-bucket \
  --bucket BUCKET_NAME \
  --region REGION \
  --create-bucket-configuration LocationConstraint=REGION

# us-east-1 is the one exception — omit --create-bucket-configuration entirely:
aws s3api create-bucket --bucket BUCKET_NAME --region us-east-1

aws s3api put-public-access-block \
  --bucket BUCKET_NAME \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false
```

---

## 2. Add the bucket policy

This is what actually makes photos readable by anyone — scoped to exactly
the two things the app serves publicly: images under `photos/` and
`manifest.json`. Nothing else in the bucket is exposed, and this grants
**read only** — no listing, no writing.

Save this as `policy.json` (substitute your real bucket name in both ARNs):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadPhotosAndManifest",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": [
        "arn:aws:s3:::BUCKET_NAME/photos/*",
        "arn:aws:s3:::BUCKET_NAME/manifest.json"
      ]
    }
  ]
}
```

### Console

S3 console → your bucket → **Permissions** tab → **Bucket policy** → **Edit**
→ paste the JSON above (with your bucket name substituted) → **Save changes**.

### CLI equivalent

```bash
aws s3api put-bucket-policy --bucket BUCKET_NAME --policy file://policy.json
```

---

## 3. Create a dedicated IAM user for uploads

Don't use your root account or personal admin credentials for the upload
script. Create a narrow-purpose IAM user that can only `PutObject` and
`GetObject` in this one bucket, on the two prefixes the script actually
touches (`photos/*`, plus `manifest.json` which it both reads and rewrites).

### Console

1. [IAM console](https://console.aws.amazon.com/iam/) → **Users** → **Create user**.
2. User name: e.g. `polaroids-uploader`.
3. On "Provide user access to the AWS Management Console" — leave this
   **unchecked**. This user only needs programmatic (access key) access, not
   a console login.
4. On the permissions step, choose **Attach policies directly**, but don't
   attach anything yet — click **Next** and **Create user** with no
   permissions attached. (You'll add a scoped inline policy next; there's no
   AWS-managed policy that's this narrow.)
5. Open the newly created user → **Permissions** tab → **Add permissions**
   → **Create inline policy** → **JSON** tab → paste:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "PolaroidsUploadAccess",
         "Effect": "Allow",
         "Action": ["s3:PutObject", "s3:GetObject"],
         "Resource": [
           "arn:aws:s3:::BUCKET_NAME/photos/*",
           "arn:aws:s3:::BUCKET_NAME/manifest.json"
         ]
       }
     ]
   }
   ```

   → **Next** → name it `polaroids-upload-policy` → **Create policy**.
6. Still on the user's page, go to the **Security credentials** tab →
   **Access keys** → **Create access key**.
7. AWS will ask for a "use case" — choose **Command Line Interface (CLI)**,
   check the acknowledgement checkbox, **Next** → (skip the optional
   description tag) → **Create access key**.
8. **Copy the Access Key ID and Secret Access Key now**, or download the
   `.csv`. The secret is shown exactly once — if you lose it, you'll need to
   create a new access key.

### CLI equivalent

If you already have credentials with IAM permissions configured (e.g. your
personal admin profile), you can do all of this from the terminal instead:

```bash
aws iam create-user --user-name polaroids-uploader

cat > polaroids-upload-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PolaroidsUploadAccess",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": [
        "arn:aws:s3:::BUCKET_NAME/photos/*",
        "arn:aws:s3:::BUCKET_NAME/manifest.json"
      ]
    }
  ]
}
EOF

aws iam put-user-policy \
  --user-name polaroids-uploader \
  --policy-name polaroids-upload-policy \
  --policy-document file://polaroids-upload-policy.json

aws iam create-access-key --user-name polaroids-uploader
```

The last command prints `AccessKeyId` and `SecretAccessKey` in its JSON
output — copy them now, the secret isn't retrievable later.

---

## 4. Configure credentials locally

The upload script never reads AWS keys directly — it relies on the AWS SDK's
default credential chain, which checks (roughly in order) environment
variables, a named CLI profile, then `~/.aws/credentials`. The simplest
setup is a **named profile** just for this project:

```bash
aws configure --profile polaroids
```

It will prompt for:

```
AWS Access Key ID [None]: <paste the Access Key ID from step 3>
AWS Secret Access Key [None]: <paste the Secret Access Key from step 3>
Default region name [None]: REGION
Default output format [None]: json
```

This writes into `~/.aws/credentials` and `~/.aws/config` under a
`[polaroids]` / `[profile polaroids]` section — it does not touch any other
profile you already have.

To point the upload script at this profile, export `AWS_PROFILE` before
running it:

```bash
export AWS_PROFILE=polaroids
npm run upload -- photo.jpg
```

or inline, one-off:

```bash
AWS_PROFILE=polaroids npm run upload -- photo.jpg
```

If you'd rather not export it every session, add `export AWS_PROFILE=polaroids`
to your shell profile (`~/.zshrc`).

---

## 5. `.env.local`

Copy `.env.example` to `.env.local` in the project root and fill in the
three values from the steps above. `.env.local` is gitignored — it's never
committed.

Worked example, assuming bucket `sam-polaroids-photos` in `us-east-1`:

```bash
S3_BUCKET=sam-polaroids-photos
S3_REGION=us-east-1
PHOTOS_BASE_URL=https://sam-polaroids-photos.s3.us-east-1.amazonaws.com
```

`AWS_PROFILE` is set in your shell (step 4), not in this file, but you can
also put `AWS_PROFILE=polaroids` in `.env.local` if you'd rather not export
it manually — the upload script loads `.env.local` before talking to AWS,
and won't clobber a value you've already exported in your shell.

---

## 6. Verify it works

Upload something real, in dry-run first so nothing hits S3 yet:

```bash
npm run upload -- ~/Desktop/test-photo.jpg --dry-run
```

You should see per-file processing output (date detected, renditions and
their sizes) and a "Dry run" banner, with no actual uploads. If this fails
on a missing environment variable or an AWS credentials/permissions error,
fix that before continuing.

Then upload for real:

```bash
npm run upload -- ~/Desktop/test-photo.jpg
```

Confirm the manifest is publicly readable:

```bash
curl -s https://BUCKET_NAME.s3.REGION.amazonaws.com/manifest.json
```

You should get back JSON with your test photo in `photos`. Confirm the
image itself loads too (this checks headers, not just that it downloads):

```bash
curl -sI https://BUCKET_NAME.s3.REGION.amazonaws.com/photos/<id>/full.jpg
```

Look for `HTTP/1.1 200 OK`, `content-type: image/jpeg`, and a `cache-control`
header matching `public, max-age=31536000, immutable`.

If `curl` gets `AccessDenied` instead: re-check the Block Public Access
settings (both the bucket-level and account-level ones — step 1) and that
the bucket policy in step 2 has your real bucket name in both ARNs.

---

## 7. Optional: CloudFront in front of the bucket

*Skip this section if plain S3 is good enough for you — it already serves
HTTPS on the `s3.REGION.amazonaws.com` domain. Do this if you want a
shorter/custom domain, or want edge caching closer to your (or your
readers') location.*

1. [CloudFront console](https://console.aws.amazon.com/cloudfront/) →
   **Create distribution**.
2. **Origin domain**: select your bucket from the dropdown (it will offer
   the S3 REST endpoint, e.g. `BUCKET_NAME.s3.REGION.amazonaws.com` — pick
   that, not an S3 "website" endpoint).
3. **Origin access**: choose **Origin access control settings
   (recommended)** → **Create new OAC** → accept the defaults → **Create**.
4. **Viewer protocol policy**: "Redirect HTTP to HTTPS".
5. **Cache policy**: use the AWS managed **CachingOptimized** policy. It
   respects `Cache-Control` headers from the origin within its TTL bounds
   (1 second to 1 year), which covers both this script's `max-age=60` on
   `manifest.json` and `max-age=31536000` on images — no custom cache policy
   needed.
6. Leave the rest at defaults and **Create distribution**. It takes a few
   minutes to deploy.
7. CloudFront will show a banner saying the origin's S3 bucket policy needs
   updating to allow this distribution's OAC. Click through it (or go to
   the distribution's **Origin** tab → **Copy policy**) and merge the
   generated statement into your bucket policy — it grants
   `cloudfront.amazonaws.com` read access scoped to this one distribution.
   You can keep the existing public-read statement from step 2 alongside it
   (harmless, just redundant with CloudFront in front), or remove it and
   re-enable full Block Public Access on the bucket so the *only* way to
   read objects is through CloudFront — the more locked-down option, and
   the better choice once CloudFront is your only reader.

Once the distribution's `Status` is "Deployed", it gives you a domain like
`d1a2b3c4d5e6f7.cloudfront.net`. Update `.env.local`:

```bash
PHOTOS_BASE_URL=https://d1a2b3c4d5e6f7.cloudfront.net
```

Re-run the verify steps in section 6 against this new URL instead of the S3
one. No invalidations are typically needed going forward: image keys are
never overwritten (each `id` is permanent, cached for a year), and
`manifest.json`'s own 60-second `max-age` means CloudFront picks up changes
on its own shortly after each upload.
