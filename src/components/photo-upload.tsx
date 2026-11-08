"use client";

import { useState } from "react";
import { prepareProgressPhoto, saveProgressPhoto } from "@/app/(app)/track/actions";
import { createBrowserSupabase } from "@/lib/supabase/client";

const POSES = [
  { value: "front", label: "Front" },
  { value: "side", label: "Side" },
  { value: "back", label: "Back" },
  { value: "other", label: "Other" },
];

// Pick a pose and a photo; it uploads privately and appears in the gallery.
export function PhotoUpload({ today }: { today: string }) {
  const [pose, setPose] = useState("front");
  const [status, setStatus] = useState<{ kind: "idle" | "busy" | "done" | "error"; text?: string }>({ kind: "idle" });

  async function upload(file: File) {
    setStatus({ kind: "busy", text: "Uploading..." });
    const prepared = await prepareProgressPhoto({ fileName: file.name, size: file.size });
    if (prepared.error || !prepared.path || !prepared.token) {
      setStatus({ kind: "error", text: prepared.error ?? "We couldn't start the upload." });
      return;
    }
    const { error } = await createBrowserSupabase()
      .storage.from("progress-photos")
      .uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type || undefined });
    if (error) {
      setStatus({ kind: "error", text: "The upload stopped. Check your connection and try again." });
      return;
    }
    const saved = await saveProgressPhoto({ path: prepared.path, pose, day: today });
    setStatus(saved.error ? { kind: "error", text: saved.error } : { kind: "done", text: "Added." });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Pose</span>
        <select value={pose} onChange={(event) => setPose(event.target.value)} className="field-input">
          {POSES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Photo</span>
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
          {status.text}
        </p>
      )}
    </div>
  );
}
