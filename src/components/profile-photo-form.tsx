"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  cancelMyProfilePhotoUpload,
  finishMyProfilePhotoUpload,
  prepareMyProfilePhotoUpload,
  removeMyProfilePhoto,
} from "@/app/(app)/profile/photo-actions";
import { useT } from "@/i18n/client";
import { createBrowserSupabase } from "@/lib/supabase/client";
import {
  PROFILE_PHOTO_BUCKET,
  validateProfilePhotoDescriptor,
} from "@/lib/profile-photo-shared";

type Status = { kind: "success" | "error"; text: string } | null;
type BusyOperation = "upload" | "remove" | null;

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?"
  );
}

export function ProfilePhotoForm({
  currentPhotoUrl,
  displayName,
}: {
  currentPhotoUrl: string | null;
  displayName: string;
}) {
  const t = useT().profile.photo;
  const fileInputId = useId();
  const imageRef = useRef<HTMLImageElement>(null);
  const [photoOverride, setPhotoOverride] = useState<{
    source: string | null;
    url: string | null;
  } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyOperation>(null);
  const [status, setStatus] = useState<Status>(null);
  const photoUrl =
    photoOverride?.source === currentPhotoUrl
      ? photoOverride.url
      : currentPhotoUrl;
  const displayedUrl = previewUrl ?? photoUrl;
  const imageFailed = displayedUrl !== null && failedImageUrl === displayedUrl;

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);
  useEffect(() => {
    if (!displayedUrl) return;
    const frame = requestAnimationFrame(() => {
      const image = imageRef.current;
      if (image?.complete && image.naturalWidth === 0)
        setFailedImageUrl(displayedUrl);
    });
    return () => cancelAnimationFrame(frame);
  }, [displayedUrl]);

  const errorText = (key?: string) =>
    key && Object.hasOwn(t.errors, key)
      ? t.errors[key as keyof typeof t.errors]
      : t.errors["save-failed"];

  async function upload(file: File) {
    const descriptor = validateProfilePhotoDescriptor({
      contentType: file.type,
      size: file.size,
    });
    if ("error" in descriptor) {
      setStatus({ kind: "error", text: errorText(descriptor.error) });
      return;
    }

    setPreviewUrl(URL.createObjectURL(file));
    setStatus(null);
    setBusy("upload");
    let path: string | undefined;
    try {
      const prepared = await prepareMyProfilePhotoUpload(descriptor);
      if (!prepared.path || !prepared.token || !prepared.contentType) {
        setPreviewUrl(null);
        setStatus({ kind: "error", text: errorText(prepared.error) });
        return;
      }
      path = prepared.path;
      const { error: uploadError } = await createBrowserSupabase()
        .storage.from(PROFILE_PHOTO_BUCKET)
        .uploadToSignedUrl(prepared.path, prepared.token, file, {
          contentType: prepared.contentType,
        });
      if (uploadError) {
        await cancelMyProfilePhotoUpload(prepared.path);
        setPreviewUrl(null);
        setStatus({ kind: "error", text: t.errors["upload-failed"] });
        return;
      }

      const saved = await finishMyProfilePhotoUpload(prepared.path);
      if (saved.error) {
        await cancelMyProfilePhotoUpload(prepared.path);
        setPreviewUrl(null);
        setStatus({ kind: "error", text: errorText(saved.error) });
        return;
      }
      setPhotoOverride({ source: currentPhotoUrl, url: saved.photoUrl ?? photoUrl });
      setPreviewUrl(null);
      setStatus({ kind: "success", text: t.uploadSuccess });
    } catch {
      if (path) await cancelMyProfilePhotoUpload(path).catch(() => undefined);
      setPreviewUrl(null);
      setStatus({ kind: "error", text: t.errors["upload-failed"] });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("remove");
    setStatus(null);
    try {
      const result = await removeMyProfilePhoto();
      if (result.error) {
        setStatus({ kind: "error", text: errorText(result.error) });
        return;
      }
      setPhotoOverride({ source: currentPhotoUrl, url: null });
      setPreviewUrl(null);
      setStatus({ kind: "success", text: t.removeSuccess });
    } catch {
      setStatus({ kind: "error", text: t.errors["remove-failed"] });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="members-roster-profile-photo max-w-xl space-y-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div>
        <h2 className="text-xl">{t.title}</h2>
        <p className="mt-1 text-sm text-muted">{t.body}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">{t.privacy}</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-full border border-accent/40 bg-surface-raised text-xl font-bold text-accent">
          {displayedUrl && !imageFailed ? (
            // Supabase serves the already-validated private image through a short-lived URL.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imageRef}
              src={displayedUrl}
              alt={previewUrl ? t.previewAlt : t.imageAlt}
              className="size-full object-cover"
              onError={() => setFailedImageUrl(displayedUrl)}
            />
          ) : (
            <span aria-hidden="true">{initials(displayName)}</span>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <input
            id={fileInputId}
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            disabled={Boolean(busy)}
            className="peer sr-only"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void upload(file);
              event.currentTarget.value = "";
            }}
          />
          <label
            htmlFor={fileInputId}
            className={`btn-secondary cursor-pointer px-4 py-2 text-sm peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${busy ? "pointer-events-none opacity-60" : ""}`}
          >
            {displayedUrl ? t.replace : t.upload}
          </label>
          {(photoUrl || previewUrl) && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={Boolean(busy)}
              className="btn-secondary px-4 py-2 text-sm"
            >
              {t.remove}
            </button>
          )}
          <p className="w-full text-xs text-muted">{t.fileHint}</p>
        </div>
      </div>
      {busy && (
        <p role="status" aria-live="polite" className="text-sm text-muted">
          {busy === "upload" ? t.uploading : t.removing}
        </p>
      )}
      {status && (
        <p
          role={status.kind === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`text-sm ${status.kind === "error" ? "text-danger" : "text-success"}`}
        >
          {status.text}
        </p>
      )}
    </section>
  );
}
