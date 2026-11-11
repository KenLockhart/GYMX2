import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ActionForm,
  Field,
  FormStatus,
  SubmitButton,
} from "@/components/form-parts";
import { PillarTag } from "@/components/game-parts";
import { PILLARS } from "@/lib/achievements";
import { LOCALE_TAG, type Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import { getLocale, getT } from "@/i18n/server";
import { requireAccount } from "@/lib/auth";
import { nextDay, progressPercent, unlockedThrough } from "@/lib/programs";
import { todayKey } from "@/lib/reminders";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";
import {
  deleteProgram,
  deleteProgramDay,
  leaveProgram,
  saveProgramDay,
  setProgramDayDone,
  startProgram,
  updateProgram,
} from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).programs.program };
}

type Day = {
  id: string;
  day_number: number;
  title: string;
  instructions: string;
  pillar: string;
  video_id: string | null;
  video: { title: string } | null;
};

function shiftDay(key: string, days: number, locale: Locale) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toLocaleDateString(LOCALE_TAG[locale], {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function DayForm({
  programId,
  day,
  nextNumber,
  videos,
  t,
  pillars,
}: {
  programId: string;
  day?: Day;
  nextNumber: number;
  videos: { id: string; title: string }[];
  t: Messages["programs"];
  pillars: Record<string, string>;
}) {
  return (
    <ActionForm
      action={saveProgramDay}
      className="grid gap-3 sm:grid-cols-[6rem_1fr_10rem]"
    >
      <input type="hidden" name="program_id" value={programId} />
      <input type="hidden" name="day_id" value={day?.id ?? ""} />
      <Field
        label={t.day}
        name="day_number"
        type="number"
        min={1}
        max={365}
        defaultValue={String(day?.day_number ?? nextNumber)}
        required
      />
      <Field
        label={t.programTitle}
        name="title"
        maxLength={120}
        defaultValue={day?.title}
        placeholder={t.dayTitlePlaceholder}
        required
      />
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t.pillar}</span>
        <select
          name="pillar"
          defaultValue={day?.pillar ?? ""}
          required
          className="field-input"
        >
          <option value="" disabled>
            {t.choose}
          </option>
          {PILLARS.map((pillar) => (
            <option key={pillar.value} value={pillar.value}>
              {pillars[pillar.value]}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1.5 sm:col-span-2">
        <span className="text-sm font-medium">{t.instructions}</span>
        <textarea
          name="instructions"
          rows={2}
          maxLength={2000}
          defaultValue={day?.instructions}
          className="field-input"
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t.videoOptional}</span>
        <select
          name="video_id"
          defaultValue={day?.video_id ?? ""}
          className="field-input"
        >
          <option value="">{t.noVideo}</option>
          {videos.map((video) => (
            <option key={video.id} value={video.id}>
              {video.title}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-3 sm:col-span-3">
        <SubmitButton
          pendingText={t.saving}
          className={day ? "btn-secondary" : "btn-primary"}
        >
          {day ? t.saveDay : t.addDay}
        </SubmitButton>
        <FormStatus />
      </div>
    </ActionForm>
  );
}

export default async function ProgramPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireAccount();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const all = await getT();
  const t = all.programs;
  const locale = await getLocale();

  const supabase = await createClient();
  const { data: program } = await supabase
    .from("programs")
    .select(
      "id, coach_id, title, description, published, coach:profiles!coach_id(display_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!program) notFound();
  const coachName =
    (program.coach as unknown as { display_name: string } | null)
      ?.display_name ?? t.yourCoach;

  const { data: dayData } = await supabase
    .from("program_days")
    .select(
      "id, day_number, title, instructions, pillar, video_id, video:videos(title)",
    )
    .eq("program_id", id)
    .order("day_number");
  const days = (dayData ?? []) as unknown as Day[];
  const isOwner = program.coach_id === profile.id;

  if (isOwner) {
    const [{ data: videoData }, { data: enrollmentData }] = await Promise.all([
      supabase
        .from("videos")
        .select("id, title")
        .eq("coach_id", profile.id)
        .eq("status", "ready")
        .order("created_at", { ascending: false }),
      supabase
        .from("program_enrollments")
        .select(
          "id, started_on, member:profiles!member_id(display_name), program_day_completions(count)",
        )
        .eq("program_id", id)
        .order("created_at", { ascending: false }),
    ]);
    const videos = (videoData ?? []) as { id: string; title: string }[];
    const enrollments = (enrollmentData ?? []) as unknown as {
      id: string;
      started_on: string;
      member: { display_name: string } | null;
      program_day_completions: { count: number }[];
    }[];
    const nextNumber = (days.at(-1)?.day_number ?? 0) + 1;

    return (
      <div className="space-y-8">
        <Link href="/programs" className="text-link text-sm">
          {t.back}
        </Link>
        <ActionForm action={updateProgram} className="max-w-2xl space-y-3">
          <input type="hidden" name="program_id" value={program.id} />
          <Field
            label={t.programTitle}
            name="title"
            maxLength={120}
            defaultValue={program.title}
            required
          />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t.description}</span>
            <textarea
              name="description"
              rows={3}
              maxLength={2000}
              defaultValue={program.description}
              className="field-input"
            />
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="published"
              defaultChecked={program.published}
              className="mt-0.5 size-4 accent-accent"
            />
            <span>
              {t.published}
              <span className="block text-muted">{t.publishedHint}</span>
            </span>
          </label>
          <div className="flex items-center gap-3">
            <SubmitButton pendingText={t.saving} className="btn-primary">
              {t.saveProgram}
            </SubmitButton>
            <FormStatus />
          </div>
        </ActionForm>

        <section className="space-y-4">
          <h2 className="text-2xl">{t.days(t.weeks(days.length))}</h2>
          {days.map((day) => (
            <div
              key={day.id}
              className="space-y-3 rounded-lg border border-border bg-surface p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 font-semibold">
                  {t.dayTitle(day.day_number, day.title)}{" "}
                  <PillarTag pillar={day.pillar} />
                </p>
                <ActionForm
                  action={deleteProgramDay}
                  confirmMessage={t.confirmRemoveDay(day.day_number)}
                >
                  <input type="hidden" name="day_id" value={day.id} />
                  <input type="hidden" name="program_id" value={program.id} />
                  <SubmitButton
                    pendingText={t.removing}
                    className="text-sm text-muted hover:text-danger"
                  >
                    {t.remove}
                  </SubmitButton>
                </ActionForm>
              </div>
              <details>
                <summary className="cursor-pointer text-sm text-muted">
                  {t.edit}
                </summary>
                <div className="mt-3">
                  <DayForm
                    programId={program.id}
                    day={day}
                    nextNumber={nextNumber}
                    videos={videos}
                    t={t}
                    pillars={all.options.pillars}
                  />
                </div>
              </details>
            </div>
          ))}
          <div className="space-y-3 rounded-lg border border-dashed border-border p-4">
            <p className="font-semibold">{t.addDayN(nextNumber)}</p>
            <DayForm
              programId={program.id}
              nextNumber={nextNumber}
              videos={videos}
              t={t}
              pillars={all.options.pillars}
            />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl">{t.membersOn}</h2>
          {enrollments.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
              {t.nobody}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
              {enrollments.map((row) => {
                const done = row.program_day_completions[0]?.count ?? 0;
                return (
                  <li
                    key={row.id}
                    className="flex flex-wrap justify-between gap-2 p-3"
                  >
                    <span className="font-medium">
                      {row.member?.display_name ?? t.aMember}
                    </span>
                    <span className="text-muted">
                      {t.memberProgress(
                        Math.min(
                          unlockedThrough(row.started_on, todayKey()),
                          days.length,
                        ),
                        done,
                        days.length,
                        progressPercent(done, days.length),
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <ActionForm
          action={deleteProgram}
          confirmMessage={t.confirmDelete(program.title)}
        >
          <input type="hidden" name="program_id" value={program.id} />
          <SubmitButton
            pendingText={t.deleting}
            className="text-sm text-muted hover:text-danger"
          >
            {t.delete}
          </SubmitButton>
          <FormStatus />
        </ActionForm>
      </div>
    );
  }

  // Members and admins.
  const { data: enrollment } = await supabase
    .from("program_enrollments")
    .select("id, started_on")
    .eq("program_id", id)
    .eq("member_id", profile.id)
    .maybeSingle();
  const { data: completionData } = enrollment
    ? await supabase
        .from("program_day_completions")
        .select("day_id")
        .eq("enrollment_id", enrollment.id)
    : { data: [] };
  const completed = new Set(
    (completionData ?? []).map((row) => row.day_id as string),
  );
  const today = todayKey();
  const unlocked = enrollment
    ? unlockedThrough(enrollment.started_on, today)
    : 0;
  const upNext = enrollment ? nextDay(days, completed, unlocked) : null;
  const percent = progressPercent(completed.size, days.length);

  return (
    <div className="space-y-8">
      <Link href="/programs" className="text-link text-sm">
        {t.back}
      </Link>
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">
          {t.byCoach(coachName)}
        </p>
        <h1 className="mt-1 text-5xl">{program.title}</h1>
        <p className="mt-2 text-sm text-muted">{t.weeks(days.length)}</p>
        {program.description && (
          <p className="mt-3 max-w-2xl whitespace-pre-line">
            {program.description}
          </p>
        )}
      </div>

      {enrollment ? (
        <div className="max-w-2xl space-y-2">
          <div className="flex justify-between text-sm">
            <span>{t.daysDone(completed.size, days.length)}</span>
            <span className="text-muted">
              {upNext ? t.upNext(upNext.day_number) : t.caughtUp}
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-surface-raised">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      ) : (
        profile.role === "member" && (
          <ActionForm action={startProgram}>
            <input type="hidden" name="program_id" value={program.id} />
            <SubmitButton pendingText={t.starting} className="btn-primary">
              {t.startToday}
            </SubmitButton>
            <FormStatus />
          </ActionForm>
        )
      )}

      <ol className="space-y-3">
        {days.map((day) => {
          const isOpen = !enrollment || day.day_number <= unlocked;
          const isDone = completed.has(day.id);
          return (
            <li
              key={day.id}
              className={`rounded-lg border p-4 ${
                upNext?.id === day.id
                  ? "border-accent bg-surface"
                  : isOpen
                    ? "border-border bg-surface"
                    : "border-border opacity-60"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {isDone && <span aria-hidden="true">✓</span>}
                    {t.dayTitle(day.day_number, day.title)}{" "}
                    <PillarTag pillar={day.pillar} />
                  </p>
                  {isOpen ? (
                    <>
                      {day.instructions && (
                        <p className="mt-2 max-w-2xl whitespace-pre-line text-sm">
                          {day.instructions}
                        </p>
                      )}
                      {day.video_id && (
                        <Link
                          href={`/library/${day.video_id}`}
                          className="text-link mt-2 inline-block text-sm"
                        >
                          {t.watch(day.video?.title ?? t.theVideo)}
                        </Link>
                      )}
                    </>
                  ) : (
                    enrollment && (
                      <p className="mt-1 text-sm text-muted">
                        {t.unlocks(
                          shiftDay(
                            enrollment.started_on,
                            day.day_number - 1,
                            locale,
                          ),
                        )}
                      </p>
                    )
                  )}
                </div>
                {enrollment && isOpen && (
                  <ActionForm action={setProgramDayDone} className="space-y-1">
                    <input
                      type="hidden"
                      name="enrollment_id"
                      value={enrollment.id}
                    />
                    <input type="hidden" name="day_id" value={day.id} />
                    <input type="hidden" name="program_id" value={program.id} />
                    <input
                      type="hidden"
                      name="done"
                      value={isDone ? "false" : "true"}
                    />
                    <SubmitButton
                      pendingText={t.saving}
                      className={
                        isDone
                          ? "btn-secondary px-3 py-2 text-sm"
                          : "btn-primary px-3 py-2 text-sm"
                      }
                    >
                      {isDone ? t.undo : t.markDone}
                    </SubmitButton>
                    <FormStatus />
                  </ActionForm>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {enrollment && (
        <ActionForm
          action={leaveProgram}
          confirmMessage={t.confirmLeave(program.title)}
        >
          <input type="hidden" name="enrollment_id" value={enrollment.id} />
          <SubmitButton
            pendingText={t.leaving}
            className="text-sm text-muted hover:text-danger"
          >
            {t.leave}
          </SubmitButton>
          <FormStatus />
        </ActionForm>
      )}
    </div>
  );
}
