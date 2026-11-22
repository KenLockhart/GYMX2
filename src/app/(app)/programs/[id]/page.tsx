import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ActionForm,
  Field,
  FormStatus,
  SubmitButton,
} from "@/components/form-parts";
import { PillarTag } from "@/components/game-parts";
import { ProgramPurchasePanel } from "@/components/program-purchase-panel";
import { PILLARS } from "@/lib/achievements";
import { LOCALE_TAG, type Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import { getLocale, getT } from "@/i18n/server";
import { requireAccount } from "@/lib/auth";
import { isProgramPaidAuthoringEnabled } from "@/lib/program-authoring-server";
import { isProgramPurchaseEnabled } from "@/lib/program-purchase-server";
import { isProgramCheckoutEnabled } from "@/lib/program-checkout-server";
import { loadProgramProgressSummariesForProgram } from "@/lib/program-progress-data";
import { parseProgramVersionedProgress } from "@/lib/program-versioned-progress";
import {
  canPreviewProgramIntro,
  progressPercent,
} from "@/lib/programs";
import { getPlayerUrl, isStreamConfigured } from "@/lib/stream";
import { createAdminClient } from "@/lib/supabase/admin";
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

type ProgramIntro = {
  title: string;
  description: string;
  playerUrl: string | null;
};

async function loadProgramIntro(input: {
  videoId: string | null;
  creatorId: string;
  isOwner: boolean;
  isPublished: boolean;
}): Promise<ProgramIntro | null> {
  if (!input.videoId) return null;

  // The program row is already visible to this signed-in user through Programs RLS.
  // Resolve only its exact, creator-owned intro reference; never widen Library access.
  const { data } = await createAdminClient()
    .from("videos")
    .select("id, coach_id, title, description, cloudflare_uid, status")
    .eq("id", input.videoId)
    .eq("coach_id", input.creatorId)
    .eq("status", "ready")
    .maybeSingle();
  const canPreview = canPreviewProgramIntro({
    isOwner: input.isOwner,
    isPublished: input.isPublished,
    programIsVisible: true,
    creatorId: input.creatorId,
    video: data
      ? { id: data.id, creatorId: data.coach_id, status: data.status }
      : null,
  });
  if (!data || !canPreview) return null;

  let playerUrl: string | null = null;
  if (isStreamConfigured()) {
    try {
      playerUrl = await getPlayerUrl(data.cloudflare_uid);
    } catch {
      playerUrl = null;
    }
  }
  return { title: data.title, description: data.description, playerUrl };
}

function ProgramIntroPreview({
  intro,
  t,
}: {
  intro: ProgramIntro;
  t: Messages["programs"];
}) {
  return (
    <section className="max-w-3xl space-y-3">
      <h2 className="text-2xl">{t.programIntro}</h2>
      {intro.playerUrl ? (
        <div className="relative aspect-video overflow-hidden rounded-lg bg-surface">
          <iframe
            src={intro.playerUrl}
            title={intro.title}
            className="absolute inset-0 size-full border-0"
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <p
          role="status"
          className="rounded-lg border border-border bg-surface p-4 text-sm text-muted"
        >
          {t.introVideoUnavailable}
        </p>
      )}
      <p className="font-medium">{intro.title}</p>
      {intro.description && (
        <p className="whitespace-pre-line text-sm text-muted">
          {intro.description}
        </p>
      )}
    </section>
  );
}

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
  let ownProgress = null as ReturnType<typeof parseProgramVersionedProgress>;
  if (profile.role === "member") {
    const { data, error } = await supabase.rpc("get_program_versioned_progress", {
      target_program_id: id,
      target_member_id: null,
    });
    ownProgress = error ? null : parseProgramVersionedProgress(data);
    if (ownProgress && (ownProgress.programId !== id || ownProgress.memberId !== profile.id)) {
      ownProgress = null;
    }
  }
  const { data: program } = await supabase
    .from("programs")
    .select(
      "id, coach_id, title, description, published, platform_owned, intro_video_id, coach:profiles!coach_id(display_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!program) {
    if (profile.role === "member" && ownProgress) {
      return (
        <div className="max-w-3xl space-y-5">
          <Link href="/programs" className="text-link text-sm">
            {t.back}
          </Link>
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-accent">
              {t.program}
            </p>
            <h1 className="mt-1 text-4xl">{ownProgress.programTitle}</h1>
            <p className="mt-2 text-sm text-muted">
              {t.historyProgress(ownProgress.lifetimeCompletedCount)}
            </p>
          </div>
          {ownProgress.history.length > 0 && (
            <ol className="space-y-2">
              {ownProgress.history.map((entry) => (
                <li key={`${entry.eventSequence}:${entry.lessonId}`} className="rounded-lg border border-border bg-surface p-3 text-sm">
                  <span aria-hidden="true">{entry.state === "completed" ? "✓" : "↶"}</span>{" "}
                  {t.dayTitle(entry.lessonOrdinal, entry.title)}
                </li>
              ))}
            </ol>
          )}
        </div>
      );
    }
    notFound();
  }
  const isOwner =
    program.coach_id === profile.id &&
    ((profile.role === "coach" && !program.platform_owned) ||
      (profile.role === "admin" && program.platform_owned));
  const coachName = program.platform_owned
    ? t.platform
    : (program.coach as unknown as { display_name: string } | null)
        ?.display_name ?? t.yourCoach;

  const intro = await loadProgramIntro({
    videoId: program.intro_video_id,
    creatorId: program.coach_id,
    isOwner,
    isPublished: program.published,
  });

  if (isOwner) {
    const [{ data: dayData }, { data: videoData }, { data: enrollmentData }, summaries] = await Promise.all([
      supabase
        .from("program_days")
        .select(
          "id, day_number, title, instructions, pillar, video_id, video:videos(title)",
        )
        .eq("program_id", id)
        .order("day_number"),
      supabase
        .from("videos")
        .select("id, title")
        .eq("coach_id", profile.id)
        .eq("status", "ready")
        .order("created_at", { ascending: false }),
      supabase
        .from("program_enrollments")
        .select("id, member_id")
        .eq("program_id", id)
        .order("created_at", { ascending: false }),
      loadProgramProgressSummariesForProgram(id),
    ]);
    const days = (dayData ?? []) as unknown as Day[];
    const videos = (videoData ?? []) as { id: string; title: string }[];
    const enrolledMemberIds = (enrollmentData ?? []).map((row) => row.member_id);
    const summaryMemberIds = summaries.map((row) => row.member_id);
    const memberIds = [...new Set([...enrolledMemberIds, ...summaryMemberIds])];
    const { data: memberProfiles } = memberIds.length
      ? await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", memberIds)
      : { data: [] };
    const memberNames = new Map(
      (memberProfiles ?? []).map((row) => [row.id, row.display_name]),
    );
    const nextNumber = (days.at(-1)?.day_number ?? 0) + 1;

    return (
      <div className="space-y-8">
        <Link href="/programs" className="text-link text-sm">
          {t.back}
        </Link>
        {isProgramPaidAuthoringEnabled() ? (
          <Link href={`/programs/${program.id}/manage`} className="text-link text-sm">
            Paid content and pricing
          </Link>
        ) : null}
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
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t.introVideoOptional}</span>
            <select
              name="intro_video_id"
              defaultValue={program.intro_video_id ?? ""}
              className="field-input"
            >
              <option value="">{t.noIntroVideo}</option>
              {videos.map((video) => (
                <option key={video.id} value={video.id}>
                  {video.title}
                </option>
              ))}
            </select>
            <span className="block text-xs text-muted">
              {t.introVideoHint}
            </span>
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
              <span className="block text-muted">
                {program.platform_owned
                  ? t.publishedPlatformHint
                  : t.publishedHint}
              </span>
            </span>
          </label>
          <div className="flex items-center gap-3">
            <SubmitButton pendingText={t.saving} className="btn-primary">
              {t.saveProgram}
            </SubmitButton>
            <FormStatus />
          </div>
        </ActionForm>

        {intro && <ProgramIntroPreview intro={intro} t={t} />}

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
              {day.video_id && (
                <Link
                  href={`/programs/${program.id}/days/${day.id}`}
                  className="text-link text-sm"
                >
                  {t.watch(day.video?.title ?? t.theVideo)}
                </Link>
              )}
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
          {summaries.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
              {t.nobody}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
              {summaries.map((row) => {
                return (
                  <li key={`${row.member_id}:${row.program_id}`} className="flex flex-wrap justify-between gap-2 p-3">
                    <span className="font-medium">
                      {memberNames.get(row.member_id) ?? t.aMember}
                    </span>
                    <span className="text-muted">
                      {row.mode === "history_only"
                        ? t.historyProgress(row.completed_once_count)
                        : t.currentProgress(
                            row.current_completed_count,
                            row.required_count,
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

  if (profile.role === "admin") {
    // The request-bound Program query above is the authorization gate. Admins may
    // preview its current lessons, but this path deliberately exposes no actions.
    const { data: dayData } = await createAdminClient()
      .from("program_days")
      .select(
        "id, program_id, day_number, title, instructions, pillar, video_id, video:videos(title)",
      )
      .eq("program_id", program.id)
      .order("day_number");
    const days = ((dayData ?? []) as unknown as (Day & { program_id: string })[]).filter(
      (day) => day.program_id === program.id,
    );

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

        {intro && <ProgramIntroPreview intro={intro} t={t} />}

        <section className="space-y-4">
          <h2 className="text-2xl">{t.days(t.weeks(days.length))}</h2>
          {days.map((day) => (
            <div
              key={day.id}
              className="space-y-2 rounded-lg border border-border bg-surface p-4"
            >
              <p className="flex items-center gap-2 font-semibold">
                {t.dayTitle(day.day_number, day.title)}{" "}
                <PillarTag pillar={day.pillar} />
              </p>
              {day.instructions && (
                <p className="whitespace-pre-line text-sm">
                  {day.instructions}
                </p>
              )}
              {day.video_id && (
                <Link
                  href={`/programs/${program.id}/days/${day.id}`}
                  className="text-link text-sm"
                >
                  {t.watch(day.video?.title ?? t.theVideo)}
                </Link>
              )}
            </div>
          ))}
        </section>
      </div>
    );
  }

  if (profile.role !== "member") notFound();
  const progress = ownProgress;
  if (!progress) {
    notFound();
  }
  const requiredLessons = progress.requiredLessons;
  const completed = new Set(progress.completedLessonIds);
  const accessible = new Map(
    progress.accessibleLessons.map((lesson) => [lesson.id, lesson]),
  );
  const nextLesson = progress.accessibleLessons.find(
    (lesson) => !completed.has(lesson.id),
  );
  const percent = progressPercent(
    progress.currentCompletedCount,
    progress.requiredCount,
  );
  const canStartFreeProgram =
    !progress.enrollmentId &&
    (progress.mode === "legacy_free" || progress.mode === "free_snapshot");
  const canChangeProgress = progress.accessAuthorized &&
    (progress.mode === "legacy_free" ||
      progress.mode === "free_snapshot" ||
      progress.mode === "paid_order");
  const legacyVideoRows =
    progress.mode === "legacy_free" && progress.accessibleLessonIds.length > 0
      ? (await supabase
          .from("program_days")
          .select("id, video_id, video:videos(title)")
          .eq("program_id", id)
          .in("id", progress.accessibleLessonIds)).data ?? []
      : [];
  const legacyVideos = new Map(
    legacyVideoRows.map((row) => [row.id, row]),
  );
  const purchaseEnabled = isProgramPurchaseEnabled();
  const checkoutEnabled = isProgramCheckoutEnabled();

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
        <p className="mt-2 text-sm text-muted">{t.weeks(progress.requiredCount)}</p>
        {program.description && (
          <p className="mt-3 max-w-2xl whitespace-pre-line">
            {program.description}
          </p>
        )}
      </div>

      {intro && <ProgramIntroPreview intro={intro} t={t} />}

      <ProgramPurchasePanel
        key={`${profile.id}:${program.id}`}
        buyerId={profile.id}
        programId={program.id}
        programTitle={program.title}
        purchaseEnabled={purchaseEnabled}
        checkoutEnabled={checkoutEnabled}
      />

      {progress.enrollmentId || progress.mode === "paid_order" ? (
        <div className="max-w-2xl space-y-2">
          <div className="flex justify-between text-sm">
            <span>
              {t.daysDone(progress.currentCompletedCount, progress.requiredCount)}
            </span>
            <span className="text-muted">
              {nextLesson ? t.upNext(nextLesson.lessonOrdinal) : t.caughtUp}
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-surface-raised">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      ) : canStartFreeProgram ? (
        <ActionForm action={startProgram}>
          <input type="hidden" name="program_id" value={program.id} />
          <SubmitButton pendingText={t.starting} className="btn-primary">
            {t.startToday}
          </SubmitButton>
          <FormStatus />
        </ActionForm>
      ) : progress.mode === "history_only" ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
          {t.historyProgress(progress.lifetimeCompletedCount)}
        </p>
      ) : null}

      <ol className="space-y-3">
        {requiredLessons.map((lesson) => {
          const isOpen = accessible.has(lesson.id);
          const isDone = completed.has(lesson.id);
          const content = accessible.get(lesson.id);
          const legacyMedia =
            progress.mode === "legacy_free" ? legacyVideos.get(lesson.id) : null;
          const legacyVideo = legacyMedia?.video as { title: string } | null | undefined;
          const canToggle = canChangeProgress && isOpen;
          const unlockStart = progress.startedOn ?? progress.accessStartedOn;
          return (
            <li
              key={lesson.id}
              className={`rounded-lg border p-4 ${
                nextLesson?.id === lesson.id
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
                    {t.dayTitle(lesson.timelineDayNumber, lesson.title)}{" "}
                    <PillarTag pillar={lesson.pillar} />
                  </p>
                  {isOpen ? (
                    <>
                      {content?.instructions && (
                        <p className="mt-2 max-w-2xl whitespace-pre-line text-sm">
                          {content.instructions}
                        </p>
                      )}
                      {legacyMedia?.video_id && (
                          <Link
                            href={`/programs/${program.id}/days/${lesson.id}`}
                            className="text-link mt-2 inline-block text-sm"
                          >
                            {t.watch(legacyVideo?.title ?? t.theVideo)}
                          </Link>
                      )}
                    </>
                  ) : (
                    unlockStart && progress.mode !== "paid_order" && (
                      <p className="mt-1 text-sm text-muted">
                        {t.unlocks(
                          shiftDay(
                            unlockStart,
                            lesson.timelineDayNumber - 1,
                            locale,
                          ),
                        )}
                      </p>
                    )
                  )}
                </div>
                {canToggle && (
                  <ActionForm action={setProgramDayDone} className="space-y-1">
                    <input type="hidden" name="day_id" value={lesson.id} />
                    <input type="hidden" name="program_id" value={program.id} />
                    <input
                      type="hidden"
                      name="operation_id"
                      value={randomUUID()}
                    />
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

      {progress.enrollmentId && progress.mode !== "paid_order" && (
        <ActionForm
          action={leaveProgram}
          confirmMessage={t.confirmLeave(program.title)}
        >
          <input type="hidden" name="enrollment_id" value={progress.enrollmentId} />
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
