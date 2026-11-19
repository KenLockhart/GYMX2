import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/i18n/server";
import { requireAccount } from "@/lib/auth";
import { canUseProgramDayVideo, canWatchProgramDay } from "@/lib/programs";
import { todayKey } from "@/lib/reminders";
import { getPlayerUrl, isStreamConfigured } from "@/lib/stream";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

export default async function ProgramDayVideoPage({
  params,
}: {
  params: Promise<{ id: string; dayId: string }>;
}) {
  const { profile } = await requireAccount();
  const { id, dayId } = await params;
  if (!idSchema.safeParse(id).success || !idSchema.safeParse(dayId).success)
    notFound();

  // These lookups stay on the signed-in client so Programs RLS establishes visibility first.
  const supabase = await createClient();
  const { data: program } = await supabase
    .from("programs")
    .select("id, coach_id, title, published")
    .eq("id", id)
    .maybeSingle();
  if (!program) notFound();

  const { data: day } = await supabase
    .from("program_days")
    .select("id, program_id, day_number, title, instructions, video_id")
    .eq("id", dayId)
    .eq("program_id", program.id)
    .maybeSingle();
  if (!day || day.program_id !== program.id || !day.video_id) notFound();

  let enrollment: {
    id: string;
    programId: string;
    memberId: string;
    startedOn: string;
  } | null = null;
  if (profile.role === "member") {
    const { data } = await supabase
      .from("program_enrollments")
      .select("id, program_id, member_id, started_on")
      .eq("program_id", program.id)
      .eq("member_id", profile.id)
      .maybeSingle();
    enrollment = data
      ? {
          id: data.id,
          programId: data.program_id,
          memberId: data.member_id,
          startedOn: data.started_on,
        }
      : null;
  }

  if (
    !canWatchProgramDay({
      viewerId: profile.id,
      viewerRole: profile.role,
      program: {
        id: program.id,
        creatorId: program.coach_id,
        published: program.published,
      },
      day: {
        programId: day.program_id,
        dayNumber: day.day_number,
        videoId: day.video_id,
      },
      enrollment,
      today: todayKey(),
    })
  ) {
    notFound();
  }

  // Load only the exact video referenced by this visible, authorized day. Never use the
  // general Library permission to expose another private video.
  const { data: video } = await createAdminClient()
    .from("videos")
    .select("id, coach_id, title, description, cloudflare_uid, status")
    .eq("id", day.video_id)
    .eq("coach_id", program.coach_id)
    .eq("status", "ready")
    .maybeSingle();
  if (
    !video ||
    !canUseProgramDayVideo(
      { id: video.id, creatorId: video.coach_id, status: video.status },
      { dayVideoId: day.video_id, creatorId: program.coach_id },
    )
  ) {
    notFound();
  }

  let playerUrl: string | null = null;
  if (isStreamConfigured()) {
    try {
      playerUrl = await getPlayerUrl(video.cloudflare_uid);
    } catch {
      playerUrl = null;
    }
  }

  const t = await getT();
  return (
    <div className="max-w-4xl space-y-6">
      <Link href={`/programs/${program.id}`} className="text-link text-sm">
        {t.programs.back}
      </Link>
      <div>
        <p className="text-sm text-muted">
          {t.programs.dayTitle(day.day_number, day.title)}
        </p>
        <h1 className="mt-1 text-4xl">{video.title}</h1>
      </div>
      {playerUrl ? (
        <div className="relative aspect-video overflow-hidden rounded-lg bg-surface">
          <iframe
            src={playerUrl}
            title={video.title}
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
          {t.library.cantPlay}
        </p>
      )}
      {video.description && (
        <p className="max-w-2xl whitespace-pre-line text-sm text-muted">
          {video.description}
        </p>
      )}
      {day.instructions && (
        <p className="max-w-2xl whitespace-pre-line">{day.instructions}</p>
      )}
    </div>
  );
}
