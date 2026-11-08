import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SessionTime } from "@/components/calendar-parts";
import { LiveRoom } from "@/components/live-room";
import { requireAccount } from "@/lib/auth";
import { canGoLive } from "@/lib/live";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";
import type { LiveChatMessage } from "./actions";

export const metadata: Metadata = { title: "Live session" };

export default async function LivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireAccount();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();

  // Row security: only the coach, invited members and admins can open the session.
  const supabase = await createClient();
  const { data: session } = await supabase
    .from("calendar_sessions")
    .select(
      "id, coach_id, title, starts_at, ends_at, session_invites(member_id)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!session) notFound();

  const [{ data: room }, { data: chat }] = await Promise.all([
    supabase
      .from("session_live")
      .select("playback_url, live_started_at, live_ended_at")
      .eq("session_id", id)
      .maybeSingle(),
    supabase
      .from("live_chat_messages")
      .select("id, session_id, sender_id, body, created_at")
      .eq("session_id", id)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  // Members can't read each other's profiles, so the server shares just the names.
  const inviteeIds = (session.session_invites ?? []).map(
    (row) => row.member_id as string,
  );
  const { data: people } = await createAdminClient()
    .from("profiles")
    .select("id, display_name")
    .in("id", [session.coach_id as string, ...inviteeIds]);
  const names = Object.fromEntries(
    (people ?? []).map((person) => [
      person.id as string,
      person.display_name as string,
    ]),
  );

  const isCoach = session.coach_id === profile.id;
  const invited = inviteeIds.includes(profile.id);

  return (
    <div className="space-y-6">
      <Link href={`/calendar/${session.id}`} className="text-link text-sm">
        Back to the session
      </Link>
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">
          Live
          {!isCoach && names[session.coach_id as string]
            ? ` with ${names[session.coach_id as string]}`
            : ""}
        </p>
        <h1 className="mt-1 text-4xl sm:text-5xl">{session.title}</h1>
        <p className="mt-2 text-muted">
          <SessionTime
            startsAt={session.starts_at as string}
            endsAt={session.ends_at as string}
          />
        </p>
      </div>
      <LiveRoom
        sessionId={session.id as string}
        me={profile.id}
        coachId={session.coach_id as string}
        mode={isCoach ? "coach" : "viewer"}
        canChat={isCoach || invited}
        canStart={
          isCoach &&
          canGoLive({
            starts_at: session.starts_at as string,
            ends_at: session.ends_at as string,
          })
        }
        playbackUrl={(room?.playback_url as string | undefined) ?? null}
        initialRoom={
          room
            ? {
                live_started_at: room.live_started_at as string | null,
                live_ended_at: room.live_ended_at as string | null,
              }
            : null
        }
        names={names}
        initialChat={((chat ?? []) as LiveChatMessage[]).reverse()}
      />
      <p className="text-xs text-muted">
        Live sessions aren&apos;t recorded. Only the coach is on camera. GYMX2
        admins may review live chat to keep everyone safe.
      </p>
    </div>
  );
}
