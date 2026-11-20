import type { Metadata } from "next";
import Link from "next/link";
import {
  ActionForm,
  Field,
  FormStatus,
  SubmitButton,
} from "@/components/form-parts";
import { getT } from "@/i18n/server";
import { requireAccount } from "@/lib/auth";
import { progressPercent } from "@/lib/programs";
import { createClient } from "@/lib/supabase/server";
import { createProgram, startProgram } from "./actions";
import {
  loadOwnProgramProgressSummaries,
  loadProgramCatalogLessonCounts,
  loadProgramProgressSummariesForProgram,
} from "@/lib/program-progress-data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).programs.title };
}

type Program = {
  id: string;
  coach_id: string;
  title: string;
  description: string;
  published: boolean;
  platform_owned: boolean;
  coach: { display_name: string } | null;
  program_days: { count: number }[];
};

export default async function ProgramsPage() {
  const { profile } = await requireAccount();
  const supabase = await createClient();
  const isCoach = profile.role === "coach";
  const t = (await getT()).programs;

  if (isCoach || profile.role === "admin") {
    const query = supabase
      .from("programs")
      .select(
        "id, coach_id, title, description, published, platform_owned, coach:profiles!coach_id(display_name), program_days(count)",
      )
      .order("created_at", { ascending: false });
    const [{ data }, { data: videoData }] = await Promise.all([
      isCoach ? query.eq("coach_id", profile.id) : query,
      supabase
        .from("videos")
        .select("id, title")
        .eq("coach_id", profile.id)
        .eq("status", "ready")
        .order("created_at", { ascending: false }),
    ]);
    const programs = (data ?? []) as unknown as Program[];
    const introVideos = (videoData ?? []) as { id: string; title: string }[];
    const progressByProgram = new Map<
      string,
      Awaited<ReturnType<typeof loadProgramProgressSummariesForProgram>>
    >();
    for (let start = 0; start < programs.length; start += 8) {
      const batch = programs.slice(start, start + 8);
      const summaries = await Promise.all(
        batch.map((program) =>
          loadProgramProgressSummariesForProgram(program.id, supabase),
        ),
      );
      batch.forEach((program, index) => {
        progressByProgram.set(program.id, summaries[index]);
      });
    }
    const catalogCounts = await loadProgramCatalogLessonCounts(
      programs.map((program) => ({
        id: program.id,
        dayCount: program.program_days[0]?.count ?? 0,
      })),
    );
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-5xl">{t.title}</h1>
          <p className="mt-2 max-w-2xl text-muted">
            {isCoach ? t.introCoach : t.introAdmin}
          </p>
        </div>
        {(isCoach || profile.role === "admin") && (
          <ActionForm
            action={createProgram}
            className="max-w-xl space-y-3 rounded-lg border border-dashed border-border p-4"
          >
            <p className="font-semibold">{t.new}</p>
            <Field
              label={t.programTitle}
              name="title"
              maxLength={120}
              placeholder={t.titlePlaceholder}
              required
            />
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">
                {t.descriptionOptional}
              </span>
              <textarea
                name="description"
                rows={3}
                maxLength={2000}
                className="field-input"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t.introVideoOptional}</span>
              <select name="intro_video_id" defaultValue="" className="field-input">
                <option value="">{t.noIntroVideo}</option>
                {introVideos.map((video) => (
                  <option key={video.id} value={video.id}>
                    {video.title}
                  </option>
                ))}
              </select>
              <span className="block text-xs text-muted">
                {t.introVideoHint}
              </span>
            </label>
            <FormStatus />
            <SubmitButton pendingText={t.creating} className="btn-primary">
              {t.create}
            </SubmitButton>
          </ActionForm>
        )}
        {programs.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-muted">
            {t.none}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {programs.map((program) => (
              <li
                key={program.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div>
                  <Link
                    href={`/programs/${program.id}`}
                    className="text-link font-semibold"
                  >
                    {program.title}
                  </Link>
                  <p className="text-sm text-muted">
                    {program.platform_owned
                      ? `${t.platform} · `
                      : !isCoach
                        ? `${program.coach?.display_name ?? t.aCoach} · `
                        : ""}
                    {t.weeks(catalogCounts.get(program.id) ?? 0)} ·{" "}
                    {t.started(progressByProgram.get(program.id)?.length ?? 0)} ·{" "}
                    {program.published ? t.published : t.draft}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // Members: programs they've started, and published programs from coaches they joined.
  const [ownSummaries, { data: available }] = await Promise.all([
    loadOwnProgramProgressSummaries(),
    supabase
      .from("programs")
      .select(
        "id, coach_id, title, description, published, platform_owned, coach:profiles!coach_id(display_name), program_days(count)",
      )
      .eq("published", true)
      .order("created_at", { ascending: false }),
  ]);
  const mine = ownSummaries.filter((row) => row.mode !== "not_enrolled");
  const openPrograms = (available ?? []) as unknown as Program[];
  const openProgramIds = new Set(openPrograms.map((program) => program.id));
  const catalogCounts = await loadProgramCatalogLessonCounts(
    openPrograms.map((program) => ({
      id: program.id,
      dayCount: program.program_days[0]?.count ?? 0,
    })),
  );
  const startedIds = new Set(
    mine
      .filter((row) => {
        if (!row.program_exists) return false;
        if (row.mode === "paid_order") return true;
        return (
          (row.mode === "legacy_free" || row.mode === "free_snapshot") &&
          row.enrollment_id !== null
        );
      })
      .map((row) => row.program_id),
  );
  const open = openPrograms.filter(
    (program) => !startedIds.has(program.id),
  );

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-5xl">{t.title}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t.introMember}</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-2xl">{t.yours}</h2>
        {mine.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-muted">
            {t.noneStarted}
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
          {mine.map((row) => {
              const total = row.required_count;
              const done = Math.min(row.current_completed_count, total);
              const percent = progressPercent(done, total);
              const linked =
                row.program_exists && openProgramIds.has(row.program_id);
              const currentProgress =
                row.program_exists &&
                (row.mode === "paid_order" ||
                  ((row.mode === "legacy_free" ||
                    row.mode === "free_snapshot") &&
                    row.enrollment_id !== null));
              return (
                <li
                  key={row.program_id}
                  className="rounded-lg border border-border bg-surface p-4"
                >
                  {linked ? (
                    <Link
                      href={`/programs/${row.program_id}`}
                      className="text-link font-semibold"
                    >
                      {row.program_title}
                    </Link>
                  ) : (
                    <p className="font-semibold">{row.program_title}</p>
                  )}
                  <p className="text-sm text-muted">
                    {currentProgress
                      ? t.currentProgress(done, total)
                      : t.historyProgress(row.completed_once_count)}
                  </p>
                  {currentProgress && (
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-raised">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl">{t.availablePrograms}</h2>
        {open.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-muted">
            {t.noneNew}{" "}
            <Link href="/coaches" className="text-link">
              {t.findCoach}
            </Link>
            .
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {open.map((program) => (
              <li
                key={program.id}
                className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
              >
                <div>
                  <p className="font-semibold">{program.title}</p>
                  <p className="text-sm text-muted">
                    {program.platform_owned
                      ? t.platform
                      : program.coach?.display_name ?? t.aCoach}{" "}·{" "}
                    {t.weeks(catalogCounts.get(program.id) ?? 0)}
                  </p>
                </div>
                {program.description && (
                  <p className="flex-1 whitespace-pre-line text-sm">
                    {program.description}
                  </p>
                )}
                <ActionForm action={startProgram}>
                  <input type="hidden" name="program_id" value={program.id} />
                  <SubmitButton
                    pendingText={t.starting}
                    className="btn-primary"
                  >
                    {t.startToday}
                  </SubmitButton>
                  <FormStatus />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
