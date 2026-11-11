"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field } from "@/components/form-parts";
import { useLocale, useT } from "@/i18n/client";
import { translateServerText } from "@/i18n/server-text";
import { VIDEO_CATEGORIES } from "@/lib/video-library";
import { videoSchema } from "@/lib/validation";

// Cloudflare needs chunks in multiples of 256 KiB, and recommends about 50 MB.
const CHUNK_BYTES = 50 * 1024 * 1024;

export function UploadForm() {
  const t = useT().library;
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const uploading = progress !== null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const file = formData.get("file");

    const parsed = videoSchema.safeParse({
      title: formData.get("title"),
      description: formData.get("description"),
      category: formData.get("category"),
      visibility: formData.get("visibility"),
    });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    if (!(file instanceof File) || file.size === 0)
      return setError(t.chooseFile);

    setError(null);
    setProgress(0);

    const { Upload } = await import("tus-js-client");
    new Upload(file, {
      endpoint: "/api/videos/upload",
      chunkSize: CHUNK_BYTES,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      metadata: {
        title: parsed.data.title,
        description: parsed.data.description,
        category: parsed.data.category,
        visibility: parsed.data.visibility,
      },
      onProgress: (sent, total) =>
        setProgress(Math.round((sent / total) * 100)),
      onError: () => {
        setProgress(null);
        setError(t.uploadStopped);
      },
      onSuccess: () => {
        router.push("/library");
        router.refresh();
      },
    }).start();
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
      <Field
        label={t.videoTitle}
        name="title"
        maxLength={120}
        required
        disabled={uploading}
      />
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t.description}</span>
        <textarea
          name="description"
          rows={3}
          maxLength={2000}
          disabled={uploading}
          className="field-input"
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t.category}</span>
          <select
            name="category"
            defaultValue="Other"
            disabled={uploading}
            className="field-input"
          >
            {VIDEO_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {t.categories[category] ?? category}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t.whoCanWatch}</span>
          <select
            name="visibility"
            defaultValue="members"
            disabled={uploading}
            className="field-input"
          >
            <option value="members">{t.membersWhoJoinMe}</option>
            <option value="private">{t.onlyMe}</option>
          </select>
        </label>
      </div>
      <Field
        label={t.file}
        name="file"
        type="file"
        accept="video/*"
        hint={t.fileHint}
        required
        disabled={uploading}
      />

      {error && (
        <p role="alert" className="text-sm text-danger">
          {translateServerText(error, locale)}
        </p>
      )}
      {uploading && (
        <div className="space-y-1.5" role="status">
          <p className="text-sm">{t.uploadingProgress(progress)}</p>
          <div className="h-2 overflow-hidden rounded bg-surface-raised">
            <div
              className="h-full bg-accent"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <button type="submit" disabled={uploading} className="btn-primary">
        {uploading ? t.uploading : t.submit}
      </button>
    </form>
  );
}
