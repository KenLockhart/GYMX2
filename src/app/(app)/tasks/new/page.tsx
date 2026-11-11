import type { Metadata } from "next";
import Link from "next/link";
import {
  ActionForm,
  Field,
  FormStatus,
  SubmitButton,
} from "@/components/form-parts";
import { PILLARS } from "@/lib/achievements";
import { getT } from "@/i18n/server";
import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createTask } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).tasks.give };
}

export default async function NewTaskPage() {
  const { profile } = await requireCoach();
  const all = await getT();
  const t = all.tasks;
  const n = t.new;

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
  const members = (
    (memberResult.data ?? []) as unknown as {
      member: { id: string; display_name: string } | null;
    }[]
  )
    .flatMap((row) => (row.member ? [row.member] : []))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  const missing =
    videos.length === 0 ? (
      <>
        {n.needVideo}{" "}
        <Link href="/library/upload" className="text-link">
          {n.uploadOne}
        </Link>
        .
      </>
    ) : members.length === 0 ? (
      n.noMembers
    ) : null;

  return (
    <div className="space-y-6">
      <Link href="/tasks" className="text-link text-sm">
        {n.back}
      </Link>
      <h1 className="text-5xl">{t.give}</h1>

      {videoResult.error || memberResult.error ? (
        <p role="alert" className="text-danger">
          {n.loadError}
        </p>
      ) : missing ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          {missing}
        </p>
      ) : (
        <ActionForm action={createTask} className="max-w-xl space-y-5">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{n.video}</span>
            <select name="video_id" required className="field-input">
              {videos.map((video) => (
                <option key={video.id} value={video.id}>
                  {video.title}
                </option>
              ))}
            </select>
          </label>
          <Field label={n.taskTitle} name="title" maxLength={120} required />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{n.pillar}</legend>
            <p className="text-xs text-muted">{n.pillarHint}</p>
            <div className="grid grid-cols-3 gap-2">
              {PILLARS.map((pillar) => (
                <label
                  key={pillar.value}
                  className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-border p-3 text-sm font-semibold has-[:checked]:border-accent has-[:checked]:bg-surface-raised"
                >
                  <input
                    type="radio"
                    name="pillar"
                    value={pillar.value}
                    required
                    className="accent-accent"
                  />
                  {all.options.pillars[pillar.value]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{n.instructions}</span>
            <textarea
              name="instructions"
              rows={4}
              maxLength={2000}
              className="field-input"
            />
          </label>
          <Field label={n.dueDate} name="due_on" type="date" />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{n.members}</legend>
            {members.map((member) => (
              <label
                key={member.id}
                className="flex items-center gap-3 text-sm"
              >
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
          <SubmitButton pendingText={all.common.saving} className="btn-primary">
            {n.submit}
          </SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
