"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import type { Photo } from "@/lib/photos";

/**
 * Kept in sync with the /sign contract. iOS Safari transcodes HEIC to JPEG
 * on its own when the accept list excludes HEIC — this is what makes the
 * primary iPhone path work with zero client-side conversion.
 */
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
const ACCEPT_ATTR = ACCEPTED_TYPES.join(",");
const MAX_SIZE = 50 * 1024 * 1024;
const HEIC_BRANDS = ["heic", "heix", "hevc", "heim", "hevm", "mif1", "msf1"];

type FileStatus =
  | { kind: "queued" }
  | { kind: "converting" }
  | { kind: "signing" }
  | { kind: "uploading"; percent: number }
  | { kind: "processing" }
  | { kind: "done"; photo: Photo }
  | { kind: "failed"; error: string };

type UploadEntry = {
  id: string;
  name: string;
  file: File;
  status: FileStatus;
};

/**
 * Sniffs the first 12 bytes for an ISO-BMFF `ftyp` box and a HEIC-family
 * brand. Drag-and-drop bypasses the input's `accept` filter, and drag-drop
 * often reports an empty `file.type` — the extension and MIME type can't be
 * trusted, only the bytes.
 */
async function sniffIsHeic(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (head.length < 12) return false;
  const box = String.fromCharCode(head[4], head[5], head[6], head[7]);
  if (box !== "ftyp") return false;
  const brand = String.fromCharCode(head[8], head[9], head[10], head[11]);
  return HEIC_BRANDS.includes(brand);
}

function statusLabel(status: FileStatus): string {
  switch (status.kind) {
    case "queued":
      return "queued";
    case "converting":
      return "converting from HEIC…";
    case "signing":
      return "getting a slot…";
    case "uploading":
      return `uploading ${status.percent}%`;
    case "processing":
      return "developing…";
    case "done":
      return "done";
    case "failed":
      return "failed";
  }
}

function newId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function Uploader() {
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [caption, setCaption] = useState("");
  const [alt, setAlt] = useState("");
  const [date, setDate] = useState("");

  // processEntry reads these at the moment it actually calls /process, not
  // at the moment the file was queued — so editing a caption while an
  // earlier file in the batch is still uploading still lands correctly.
  const metaRef = useRef({ caption, alt, date });
  useEffect(() => {
    metaRef.current = { caption, alt, date };
  }, [caption, alt, date]);

  const setStatus = useCallback((id: string, status: FileStatus) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, status } : e)));
  }, []);

  const processEntry = useCallback(
    async (entry: UploadEntry) => {
      const { id } = entry;
      let body: Blob = entry.file;
      let contentType = entry.file.type;
      let filename = entry.name;

      if (entry.file.size > MAX_SIZE) {
        setStatus(id, {
          kind: "failed",
          error: `Too big — ${(entry.file.size / 1024 / 1024).toFixed(1)}MB, max 50MB.`,
        });
        return;
      }

      const looksHeic = await sniffIsHeic(entry.file);

      if (looksHeic) {
        setStatus(id, { kind: "converting" });
        try {
          const heic2any = (await import("heic2any")).default;
          const result = await heic2any({
            blob: entry.file,
            toType: "image/jpeg",
            quality: 0.92,
          });
          body = Array.isArray(result) ? result[0] : result;
          contentType = "image/jpeg";
          filename = filename.replace(/\.\w+$/, "") + ".jpg";
        } catch {
          setStatus(id, {
            kind: "failed",
            error:
              "This is a HEIC photo and the in-browser converter couldn't read it. On iPhone: Share → choose \"JPEG\" under Options, then re-upload.",
          });
          return;
        }
      } else if (!(ACCEPTED_TYPES as readonly string[]).includes(contentType)) {
        setStatus(id, {
          kind: "failed",
          error: `Unsupported file type (${contentType || "unknown"}). Use JPEG, PNG, WEBP, or AVIF.`,
        });
        return;
      }

      if (body.size > MAX_SIZE) {
        setStatus(id, { kind: "failed", error: "Too big after conversion — max 50MB." });
        return;
      }

      setStatus(id, { kind: "signing" });
      let signed: { key: string; url: string };
      try {
        const res = await fetch("/api/upload/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, contentType, size: body.size }),
        });
        const json = await res.json().catch(() => ({}) as { error?: string });
        if (!res.ok) {
          setStatus(id, {
            kind: "failed",
            error: json.error ?? `Couldn't get an upload slot (${res.status}).`,
          });
          return;
        }
        signed = json as { key: string; url: string };
      } catch {
        setStatus(id, { kind: "failed", error: "Couldn't reach the server to start the upload." });
        return;
      }

      // XMLHttpRequest, not fetch — fetch can't report upload progress.
      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", signed.url);
          xhr.setRequestHeader("Content-Type", contentType);
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              setStatus(id, {
                kind: "uploading",
                percent: Math.round((event.loaded / event.total) * 100),
              });
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`Upload to storage failed (${xhr.status}).`));
          };
          // The browser deliberately hides CORS failures from JS — a blocked
          // preflight surfaces here as an indistinguishable "network error"
          // with status 0. Since a missing R2 CORS policy is overwhelmingly the
          // likeliest cause (and the one that fails ONLY in the browser, while
          // curl keeps working), name it rather than leaving a dead end.
          xhr.onerror = () =>
            reject(
              new Error(
                "Couldn't reach storage. This is usually a missing R2 CORS policy — " +
                  "add this origin to the bucket's allowed origins (see docs/WEB-UPLOAD.md).",
              ),
            );
          xhr.send(body);
        });
      } catch (err) {
        setStatus(id, {
          kind: "failed",
          error: err instanceof Error ? err.message : "Upload to storage failed.",
        });
        return;
      }

      setStatus(id, { kind: "processing" });
      try {
        const meta = metaRef.current;
        const res = await fetch("/api/upload/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: signed.key,
            ...(meta.date ? { date: meta.date } : {}),
            ...(meta.caption ? { caption: meta.caption } : {}),
            ...(meta.alt ? { alt: meta.alt } : {}),
          }),
        });
        const json = await res.json().catch(() => ({}) as { error?: string });
        if (!res.ok) {
          setStatus(id, {
            kind: "failed",
            error: json.error ?? `Couldn't finish developing the photo (${res.status}).`,
          });
          return;
        }
        setStatus(id, { kind: "done", photo: (json as { photo: Photo }).photo });
      } catch {
        setStatus(id, { kind: "failed", error: "Couldn't reach the server to finish processing." });
      }
    },
    [setStatus],
  );

  // A single promise chain serializes every file across every call to
  // handleFiles — the upload manifest is read-modify-written per photo, so
  // two uploads finishing at once would race and one would lose its entry.
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const files = Array.from(fileList);
      const newEntries: UploadEntry[] = files.map((file) => ({
        id: newId(),
        name: file.name || "photo",
        file,
        status: { kind: "queued" },
      }));

      setEntries((prev) => [...prev, ...newEntries]);

      for (const entry of newEntries) {
        queueRef.current = queueRef.current.then(() => processEntry(entry));
      }
    },
    [processEntry],
  );

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    handleFiles(event.target.files);
    event.target.value = "";
  }

  function onDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(true);
  }

  function onDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    handleFiles(event.dataTransfer.files);
  }

  return (
    <div className="flex flex-col gap-8 py-10">
      <div>
        <h1 className="display-expanded text-2xl">Develop a print.</h1>
        <p className="mt-2 leading-relaxed text-graphite">
          Drop photos in, or pick them. Several at once run one after
          another — no races on the manifest.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <label
          htmlFor="upload-dropzone"
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center gap-2 border-2 border-dashed px-6 py-12 text-center transition-colors ${
            dragActive ? "border-reagent bg-reagent/5" : "border-hairline bg-print"
          }`}
        >
          <span className="display-expanded text-lg">
            {dragActive ? "Drop it." : "Drop photos here"}
          </span>
          <span className="label-mono">or click to choose — jpeg, png, webp, avif</span>
          <input
            id="upload-dropzone"
            type="file"
            accept={ACCEPT_ATTR}
            multiple
            onChange={onInputChange}
            className="sr-only"
          />
        </label>

        <label
          htmlFor="upload-camera"
          className="label-mono flex cursor-pointer items-center justify-center gap-2 border border-hairline bg-print px-4 py-3"
        >
          take a photo now
          <input
            id="upload-camera"
            type="file"
            accept={ACCEPT_ATTR}
            capture="environment"
            onChange={onInputChange}
            className="sr-only"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="upload-caption" className="label-mono">
            caption
          </label>
          <input
            id="upload-caption"
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            className="border border-hairline bg-print px-3 py-2 text-ink outline-none"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="upload-alt" className="label-mono">
            alt text
          </label>
          <input
            id="upload-alt"
            type="text"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            className="border border-hairline bg-print px-3 py-2 text-ink outline-none"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="upload-date" className="label-mono">
            date
          </label>
          <input
            id="upload-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-hairline bg-print px-3 py-2 text-ink outline-none"
          />
          <p className="text-xs leading-relaxed text-graphite">
            Leave blank to use the shot&apos;s EXIF capture date.
          </p>
        </div>
      </div>

      {entries.length > 0 && (
        <ul aria-live="polite" className="flex flex-col gap-4">
          {entries.map((entry) => (
            <li key={entry.id} className="border-b border-hairline pb-4">
              <div className="flex items-baseline justify-between gap-4">
                <p className="min-w-0 truncate text-[15px]">{entry.name}</p>
                <p className="label-mono shrink-0">{statusLabel(entry.status)}</p>
              </div>

              {entry.status.kind === "uploading" && (
                <div className="mt-2 h-1 w-full bg-hairline">
                  <div
                    className="h-1 bg-reagent transition-[width]"
                    style={{ width: `${entry.status.percent}%` }}
                  />
                </div>
              )}

              {entry.status.kind === "failed" && (
                <p role="alert" className="mt-2 text-sm leading-relaxed text-ink">
                  {entry.status.error}
                </p>
              )}

              {entry.status.kind === "done" && (
                <div className="mt-3 flex items-end gap-4">
                  <div className="relative w-32 shrink-0 overflow-hidden border border-hairline bg-print">
                    {/* eslint-disable-next-line @next/next/no-img-element -- deliberate, matches PolaroidFrame/PhotoGrid house style */}
                    <img
                      src={entry.status.photo.thumb}
                      alt={entry.status.photo.alt ?? entry.status.photo.caption ?? entry.status.photo.date}
                      className="developing block h-auto w-full"
                    />
                    <div
                      className="developing-wash pointer-events-none absolute inset-0"
                      aria-hidden="true"
                    />
                  </div>
                  <Link href={`/photo/${entry.status.photo.id}`} className="label-mono text-reagent">
                    view print →
                  </Link>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
