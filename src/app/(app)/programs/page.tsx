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
import { progressPercent, unlockedThrough } from "@/lib/programs";
import { todayKey } from "@/lib/reminders";
import { createClient } from "@/lib/supabase/server";
import { createProgram, startProgram } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).programs.title };
}

type Program = {
  id: string;
  coach_id: string;
  title: string;
  description: string;
  published: boolean;
  coach: { display_name: string } | null;
  program_days: { count: number }[];
  program_enrollments?: { count: number }[];
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
        "id, coach_id, title, description, published, coach:profiles!coach_id(display_name), program_days(count), program_enrollments(count)",
      )
      .order("created_at", { ascending: false });
    const { data } = isCoach
      ? await query.eq("coach_id", profile.id)
      : await query;
    const programs = (data ?? []) as unknown as Program[];
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-5xl">{t.title}</h1>
          <p className="mt-2 max-w-2xl text-muted">
            {isCoach ? t.introCoach : t.introAdmin}
          </p>
        </div>
        {isCoach && (
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
                    {!isCoach &&
                      `${program.coach?.display_name ?? t.aCoach} · `}
                    {t.weeks(program.program_days[0]?.count ?? 0)} ·{" "}
                    {t.started(program.program_enrollments?.[0]?.count ?? 0)} ·{" "}
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
  const today = todayKey();
  const [{ data: enrolled }, { data: available }] = await Promise.all([
    supabase
      .from("program_enrollments")
      .select(
        "id, started_on, program:programs(id, title, coach:profiles!coach_id(display_name), program_days(count)), program_day_completions(count)",
      )
      .eq("member_id", profile.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("programs")
      .select(
        "id, coach_id, title, description, published, coach:profiles!coach_id(display_name), program_days(count)",
      )
      .eq("published", true)
      .order("created_at", { ascending: false }),
  ]);
  const mine = (enrolled ?? []) as unknown as {
    id: string;
    started_on: string;
    program: {
      id: string;
      title: string;
      coach: { display_name: string } | null;
      program_days: { count: number }[];
    } | null;
    program_day_completions: { count: number }[];
  }[];
  const startedIds = new Set(mine.map((row) => row.program?.id));
  const open = ((available ?? []) as unknown as Program[]).filter(
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
              const total = row.program?.program_days[0]?.count ?? 0;
              const done = row.program_day_completions[0]?.count ?? 0;
              const percent = progressPercent(done, total);
              return (
                <li
                  key={row.id}
                  className="rounded-lg border border-border bg-surface p-4"
                >
                  <Link
                    href={`/programs/${row.program?.id}`}
                    className="text-link font-semibold"
                  >
                    {row.program?.title ?? t.program}
                  </Link>
                  <p className="text-sm text-muted">
                    {row.program?.coach?.display_name} ·{" "}
                    {t.dayOf(
                      Math.min(unlockedThrough(row.started_on, today), total),
                      total,
                      done,
                    )}
                  </p>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-raised">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl">{t.fromCoaches}</h2>
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
                    {program.coach?.display_name} ·{" "}
                    {t.weeks(program.program_days[0]?.count ?? 0)}
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
