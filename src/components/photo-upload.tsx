"use client";

import { useState } from "react";
import {
  prepareProgressPhoto,
  saveProgressPhoto,
} from "@/app/(app)/track/actions";
import { useLocale, useT } from "@/i18n/client";
import { translateServerText } from "@/i18n/server-text";
import { createBrowserSupabase } from "@/lib/supabase/client";

const POSES = ["front", "side", "back", "other"];

// Pick a pose and a photo; it uploads privately and appears in the gallery.
export function PhotoUpload({ today }: { today: string }) {
  const t = useT().track;
  const locale = useLocale();
  const [pose, setPose] = useState("front");
  const [status, setStatus] = useState<{
    kind: "idle" | "busy" | "done" | "error";
    text?: string;
  }>({ kind: "idle" });

  async function upload(file: File) {
    setStatus({ kind: "busy", text: t.uploading });
    const prepared = await prepareProgressPhoto({
      fileName: file.name,
      size: file.size,
    });
    if (prepared.error || !prepared.path || !prepared.token) {
      setStatus({ kind: "error", text: prepared.error ?? t.couldntStart });
      return;
    }
    const { error } = await createBrowserSupabase()
      .storage.from("progress-photos")
      .uploadToSignedUrl(prepared.path, prepared.token, file, {
        contentType: file.type || undefined,
      });
    if (error) {
      setStatus({ kind: "error", text: t.uploadStopped });
      return;
    }
    const saved = await saveProgressPhoto({
      path: prepared.path,
      pose,
      day: today,
    });
    setStatus(
      saved.error
        ? { kind: "error", text: saved.error }
        : { kind: "done", text: t.added },
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t.pose}</span>
        <select
          value={pose}
          onChange={(event) => setPose(event.target.value)}
          className="field-input"
        >
          {POSES.map((option) => (
            <option key={option} value={option}>
              {t.poses[option]}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t.photo}</span>
        <input
          type="file"
          accept=".jpg,.jpeg,.png,.webp"
          disabled={status.kind === "busy"}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = "";
          }}
          className="field-input file:mr-3 file:rounded file:border-0 file:bg-surface file:px-3 file:py-1 file:text-foreground"
        />
      </label>
      {status.text && (
        <p
          role={status.kind === "error" ? "alert" : "status"}
          className={`w-full text-sm ${status.kind === "error" ? "text-danger" : status.kind === "done" ? "text-success" : "text-muted"}`}
        >
          {translateServerText(status.text, locale)}
        </p>
      )}
    </div>
  );
}
