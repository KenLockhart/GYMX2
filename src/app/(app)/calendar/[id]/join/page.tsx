import { notFound, redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth";
import { getMemberCoachIntakeClearance } from "@/lib/member-intake-server";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";
import { isSafeExternalMeetingUrl } from "@/lib/session-join";

export default async function SessionJoinPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireAccount();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: session, error } = await supabase
    .from("calendar_sessions")
    .select("id, coach_id, meeting_url, session_invites(member_id)")
    .eq("id", id)
    .maybeSingle();
  if (error || !session) notFound();

  const ownerCoach = profile.role === "coach" && session.coach_id === profile.id;
  const admin = profile.role === "admin";
  if (profile.role === "coach" && !ownerCoach) notFound();
  if (profile.role === "member") {
    const invited = (session.session_invites ?? []).some(
      (invite: { member_id: string }) => invite.member_id === profile.id,
    );
    if (!invited) notFound();
    const clearance = await getMemberCoachIntakeClearance(supabase, session.coach_id);
    if (clearance === "needs_intake") {
      const returnTo = `/calendar/${id}/join`;
      redirect(`/intake?coach=${encodeURIComponent(session.coach_id)}&returnTo=${encodeURIComponent(returnTo)}`);
    }
    if (clearance === "needs_booking") redirect(`/calendar/${id}`);
    if (clearance !== "cleared") notFound();
  } else if (!ownerCoach && !admin) {
    notFound();
  }

  if (session.meeting_url === null) redirect(`/calendar/${id}`);
  if (!isSafeExternalMeetingUrl(session.meeting_url)) notFound();
  redirect(session.meeting_url);
}
