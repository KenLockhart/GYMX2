import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Field, FormStatus, SubmitButton } from "@/components/form-parts";
import { PILLARS } from "@/lib/achievements";
import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createTask } from "../actions";

export const metadata: Metadata = { title: "Give a Task" };

export default async function NewTaskPage() {
  const { profile } = await requireCoach();

  const supabase = await createClient();
  const [videoResult, memberResult] = await Promise.all([
    supabase
      .from("videos")
      .select("id, title")
      .eq("coach_id", profile.id)
      .eq("status", "ready")
      .order("created_at", { ascending: false }),
    supabase
      .from("coach_members")
      .select("member:profiles!member_id(id, display_name)")
      .eq("coach_id", profile.id),
  ]);
  const videos = (videoResult.data ?? []) as { id: string; title: string }[];
  const members = ((memberResult.data ?? []) as unknown as {
    member: { id: string; display_name: string } | null;
  }[])
    .flatMap((row) => (row.member ? [row.member] : []))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  const missing =
    videos.length === 0 ? (
      <>
        You need a finished video first.{" "}
        <Link href="/library/upload" className="text-link">
          Upload one
        </Link>
        .
      </>
    ) : members.length === 0 ? (
      "No members have joined you yet. They can join from their Coaches page."
    ) : null;

  return (
    <div className="space-y-6">
      <Link href="/tasks" className="text-link text-sm">
        Back to Tasks
      </Link>
      <h1 className="text-5xl">Give a Task</h1>

      {videoResult.error || memberResult.error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load your videos and members. Please refresh and try again.
        </p>
      ) : missing ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">{missing}</p>
      ) : (
        <ActionForm action={createTask} className="max-w-xl space-y-5">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Video</span>
            <select name="video_id" required className="field-input">
              {videos.map((video) => (
                <option key={video.id} value={video.id}>
                  {video.title}
                </option>
              ))}
            </select>
          </label>
          <Field label="Title" name="title" maxLength={120} required />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Pillar</legend>
            <p className="text-xs text-muted">Members earn pillar badges for Tasks in each one.</p>
            <div className="grid grid-cols-3 gap-2">
              {PILLARS.map((pillar) => (
                <label
                  key={pillar.value}
                  className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-border p-3 text-sm font-semibold has-[:checked]:border-accent has-[:checked]:bg-surface-raised"
                >
                  <input type="radio" name="pillar" value={pillar.value} required className="accent-accent" />
                  {pillar.label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Instructions</span>
            <textarea name="instructions" rows={4} maxLength={2000} className="field-input" />
          </label>
          <Field label="Due date (optional)" name="due_on" type="date" />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Members</legend>
            {members.map((member) => (
              <label key={member.id} className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  name="member_ids"
                  value={member.id}
                  className="size-4 accent-accent"
                />
                {member.display_name}
              </label>
            ))}
          </fieldset>
          <FormStatus />
          <SubmitButton pendingText="Saving..." className="btn-primary">
            Give Task
          </SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
