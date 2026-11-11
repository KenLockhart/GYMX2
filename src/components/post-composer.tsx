"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPost, preparePhotoUploads } from "@/app/(app)/community/actions";
import {
  kindsFor,
  MAX_PHOTO_BYTES,
  MAX_POST_PHOTOS,
  MAX_VIDEO_BYTES,
  PHOTO_TYPES,
  POST_BODY_MAX,
  type Audience,
  type PostKind,
} from "@/lib/community";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { T, useTr } from "@/i18n/t";

type Community = { id: string; name: string };

const extensionOf = (name: string) =>
  name.split(".").pop()?.toLowerCase() ?? "";

function imageSize(file: File) {
  return new Promise<{ width: number | null; height: number | null }>(
    (resolve) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        resolve({
          width: image.naturalWidth || null,
          height: image.naturalHeight || null,
        });
        URL.revokeObjectURL(url);
      };
      image.onerror = () => {
        resolve({ width: null, height: null });
        URL.revokeObjectURL(url);
      };
      image.src = url;
    },
  );
}

export function PostComposer({
  role,
  communities,
  defaultAudience = "everyone",
  defaultCoachId = null,
  initialBody = "",
  initialKind = "general",
  progressPhoto = null,
}: {
  role: string;
  communities: Community[];
  defaultAudience?: Audience;
  defaultCoachId?: string | null;
  initialBody?: string;
  initialKind?: PostKind;
  // A Track progress photo being shared.
  progressPhoto?: { id: string; url: string } | null;
}) {
  const tr = useTr();
  const router = useRouter();
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState(initialBody);
  const [kind, setKind] = useState<PostKind>(initialKind);
  const [shared, setShared] = useState(progressPhoto);
  // Progress is private unless the person chooses otherwise.
  const [audience, setAudience] = useState<Audience>(
    initialKind === "progress" ? "only_me" : defaultAudience,
  );
  const [coachId, setCoachId] = useState<string | null>(
    defaultCoachId ?? communities[0]?.id ?? null,
  );
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([]);
  const [video, setVideo] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null;

  function pickPhotos(list: FileList | null) {
    setError(null);
    const files = [...(list ?? [])];
    if (photos.length + files.length > MAX_POST_PHOTOS)
      return setError(
        tr("Up to {MAX_POST_PHOTOS} photos per post.", { MAX_POST_PHOTOS }),
      );
    for (const file of files) {
      if (!(extensionOf(file.name) in PHOTO_TYPES))
        return setError(tr("Use JPG, PNG or WebP photos."));
      if (file.size > MAX_PHOTO_BYTES)
        return setError(tr("Each photo can be up to 10 MB."));
    }
    setVideo(null);
    setPhotos([
      ...photos,
      ...files.map((file) => ({ file, preview: URL.createObjectURL(file) })),
    ]);
  }

  function pickVideo(list: FileList | null) {
    setError(null);
    const file = list?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/"))
      return setError(tr("Choose a video file."));
    if (file.size > MAX_VIDEO_BYTES)
      return setError(tr("Videos can be up to 1 GB and 10 minutes."));
    photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
    setPhotos([]);
    setVideo(file);
  }

  async function uploadPhotos() {
    const prepared = await preparePhotoUploads(
      photos.map(({ file }) => ({ name: file.name, size: file.size })),
    );
    if (!prepared.uploads)
      throw new Error(prepared.error ?? tr("We couldn't start the upload."));
    const storage = createBrowserSupabase().storage.from("community-media");
    const done = [];
    for (const [index, { file }] of photos.entries()) {
      const target = prepared.uploads[index];
      const { error: uploadError } = await storage.uploadToSignedUrl(
        target.path,
        target.token,
        file,
        {
          contentType: PHOTO_TYPES[extensionOf(file.name)],
        },
      );
      if (uploadError)
        throw new Error(
          "A photo didn't upload. Check your connection and try again.",
        );
      done.push({ path: target.path, ...(await imageSize(file)) });
      setProgress(Math.round(((index + 1) / photos.length) * 100));
    }
    return done;
  }

  function uploadVideo(file: File) {
    return new Promise<string>(async (resolve, reject) => {
      const { Upload } = await import("tus-js-client");
      const upload = new Upload(file, {
        endpoint: "/api/community/video-upload",
        chunkSize: 50 * 1024 * 1024,
        retryDelays: [0, 3000, 5000, 10000],
        onProgress: (sent, total) =>
          setProgress(Math.round((sent / total) * 100)),
        onError: () =>
          reject(
            new Error(
              tr(
                "The video upload stopped. Check your connection and try again.",
              ),
            ),
          ),
        onSuccess: () => {
          // Cloudflare's upload address ends in the video's id.
          const uid = (upload.url ?? "").split("?")[0].split("/").pop() ?? "";
          if (/^[a-f0-9]{32}$/.test(uid)) resolve(uid);
          else
            reject(
              new Error(
                tr(
                  "The video uploaded but couldn't be attached. Please try again.",
                ),
              ),
            );
        },
      });
      upload.start();
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!body.trim() && photos.length === 0 && !video && !shared)
      return setError(tr("Write something or add a photo or video."));
    setError(null);
    setProgress(0);
    try {
      const uploaded = photos.length ? await uploadPhotos() : [];
      const videoUid = video ? await uploadVideo(video) : null;
      const result = await createPost({
        kind,
        body,
        audience,
        coachId: audience === "coach_community" ? coachId : null,
        photos: uploaded,
        videoUid,
        progressPhotoId: shared?.id ?? null,
      });
      if (result.error) throw new Error(result.error);
      photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
      setBody("");
      setPhotos([]);
      setVideo(null);
      setShared(null);
      setKind("general");
      if (shared) router.replace("/community");
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : tr("We couldn't post that. Please try again."),
      );
    } finally {
      setProgress(null);
    }
  }

  const kinds = kindsFor(role);

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-lg border border-border bg-surface p-4"
    >
      <label htmlFor="post-body" className="sr-only">
        <T>Write a post</T>
      </label>
      <textarea
        id="post-body"
        rows={3}
        maxLength={POST_BODY_MAX}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        disabled={busy}
        placeholder={tr(
          "Share a workout, a win or something that's motivating you...",
        )}
        className="field-input"
      />

      {shared && (
        <div className="flex items-center gap-3 text-sm">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage link */}
          <img
            src={shared.url}
            alt={tr("Progress photo to share")}
            className="size-20 rounded object-cover"
          />
          <span className="text-muted">
            <T>
              Your progress photo. A copy is shared; the original stays private
              in Track.
            </T>
          </span>
          <button
            type="button"
            onClick={() => setShared(null)}
            disabled={busy}
            className="cursor-pointer text-muted hover:text-danger"
          >
            <T>Remove</T>
          </button>
        </div>
      )}
      {kind === "progress" && (
        <p className="text-xs text-muted">
          <T>
            Progress posts start as Only me. Choose your coach community or
            Everyone if you want to share it.
          </T>
        </p>
      )}

      {photos.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {photos.map((photo, index) => (
            <li key={photo.preview} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview */}
              <img
                src={photo.preview}
                alt={tr("Photo {p0}", { p0: index + 1 })}
                className="size-20 rounded object-cover"
              />
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(photo.preview);
                  setPhotos(photos.filter((item) => item !== photo));
                }}
                disabled={busy}
                aria-label={tr("Remove photo {p0}", { p0: index + 1 })}
                className="absolute -right-1 -top-1 grid size-6 cursor-pointer place-items-center rounded-full bg-background text-xs shadow"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {video && (
        <p className="flex items-center gap-3 text-sm">
          <span className="truncate">Video: {video.name}</span>
          <button
            type="button"
            onClick={() => setVideo(null)}
            disabled={busy}
            className="cursor-pointer text-muted hover:text-danger"
          >
            <T>Remove</T>
          </button>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={photoInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(event) => {
            pickPhotos(event.target.files);
            event.target.value = "";
          }}
        />
        <input
          ref={videoInput}
          type="file"
          accept="video/*"
          hidden
          onChange={(event) => {
            pickVideo(event.target.files);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => photoInput.current?.click()}
          disabled={busy || photos.length >= MAX_POST_PHOTOS}
          className="btn-secondary px-3 py-2 text-sm"
        >
          <T>Add photos</T>
        </button>
        <button
          type="button"
          onClick={() => videoInput.current?.click()}
          disabled={busy}
          className="btn-secondary px-3 py-2 text-sm"
        >
          <T>Add video</T>
        </button>
        <select
          aria-label={tr("Post type")}
          value={kind}
          onChange={(event) => {
            const next = event.target.value as PostKind;
            setKind(next);
            if (next === "progress" && audience === "everyone")
              setAudience("only_me");
          }}
          disabled={busy}
          className="field-input w-auto py-2 text-sm"
        >
          {kinds.map((item) => (
            <option key={item.value} value={item.value}>
              <T>{item.label}</T>
            </option>
          ))}
        </select>
        <select
          aria-label={tr("Who can see this")}
          value={audience === "coach_community" ? `coach:${coachId}` : audience}
          onChange={(event) => {
            const value = event.target.value;
            if (value.startsWith("coach:")) {
              setAudience("coach_community");
              setCoachId(value.slice(6));
            } else setAudience(value as Audience);
          }}
          disabled={busy}
          className="field-input w-auto py-2 text-sm"
        >
          <option value="everyone">
            <T>Everyone on GYMX2</T>
          </option>
          {communities.map((community) => (
            <option key={community.id} value={`coach:${community.id}`}>
              {role === "coach"
                ? tr("My community")
                : `${community.name}'s community`}
            </option>
          ))}
          <option value="only_me">
            <T>Only me</T>
          </option>
        </select>
        <button
          type="submit"
          disabled={busy}
          className="btn-primary ml-auto px-4 py-2 text-sm"
        >
          {busy
            ? progress
              ? tr("Uploading {progress}%", { progress })
              : tr("Posting...")
            : tr("Post")}
        </button>
      </div>
      {busy && progress !== null && (photos.length > 0 || video) && (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-surface-raised"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {tr(error)}
        </p>
      )}
      <p className="text-xs text-muted">
        <T>
          Up to 6 photos (10 MB each) or one video (10 minutes, 1 GB). Be kind;
          posts can be reported.
        </T>
      </p>
    </form>
  );
}
