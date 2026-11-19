import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SessionTime } from "@/components/calendar-parts";
import { LiveRoom } from "@/components/live-room";
import {
  PrivateLiveRoom,
  PrivateOneOnOneOffer,
} from "@/components/private-live-room";
import { GroupCritiqueGate } from "@/components/group-critique-room";
import { getT } from "@/i18n/server";
import { requireAccount } from "@/lib/auth";
import { canGoLive } from "@/lib/live";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";
import { readPrivateLiveSession } from "./private-actions";
import { readGroupCritiqueSnapshot } from "./group-actions";
import type { LiveChatMessage } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).calendar.live.title };
}

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
  const { data: session, error: sessionError } = await supabase
    .from("calendar_sessions")
    .select(
      "id, coach_id, title, starts_at, ends_at, live_mode, session_invites(member_id, response)",
    )
    .eq("id", id)
    .maybeSingle();
  if (sessionError || !session) notFound();

  // Members can't read each other's profiles, so the server shares just the names.
  const invites = session.session_invites ?? [];
  const inviteeIds = invites.map((row) => row.member_id as string);
  const isCoach = session.coach_id === profile.id;
  const invited = inviteeIds.includes(profile.id);
  const privateMemberId = inviteeIds.length === 1 ? inviteeIds[0] : null;

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

  const all = (await getT()).calendar;
  const t = all.live;
  const coachName = names[session.coach_id as string];

  if (session.live_mode === "one_on_one") {
    // Never read or forward the group session_live playback URL for private sessions.
    if (
      !isCoach &&
      privateMemberId !== profile.id
    )
      notFound();
    const privateSnapshot = await readPrivateLiveSession(id);
    if (!privateSnapshot.ok || privateSnapshot.mode !== "one_on_one")
      notFound();
    const { data: privateChat } = await supabase
      .from("live_chat_messages")
      .select("id, session_id, sender_id, body, created_at")
      .eq("session_id", id)
      .order("created_at", { ascending: false })
      .limit(200);
    const memberName = privateMemberId
      ? names[privateMemberId] ?? t.private.otherParticipant
      : t.private.otherParticipant;
    const otherName = isCoach
      ? memberName
      : coachName ?? t.private.otherParticipant;

    return (
      <div className="space-y-6">
        <Link href={`/calendar/${session.id}`} className="text-link text-sm">
          {all.edit.back}
        </Link>
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-accent">
            {!isCoach && coachName ? t.liveWith(coachName) : t.private.title}
          </p>
          <h1 className="mt-1 text-4xl sm:text-5xl">{session.title}</h1>
          <p className="mt-2 text-muted">
            <SessionTime
              startsAt={session.starts_at as string}
              endsAt={session.ends_at as string}
            />
          </p>
        </div>
        <PrivateLiveRoom
          key={session.id as string}
          sessionId={session.id as string}
          startsAt={session.starts_at as string}
          endsAt={session.ends_at as string}
          me={profile.id}
          coachId={session.coach_id as string}
          otherName={otherName}
          memberId={privateMemberId}
          memberName={memberName}
          canChat={isCoach || invited}
          names={names}
          initialChat={((privateChat ?? []) as LiveChatMessage[]).reverse()}
          initialSnapshot={{ mode: privateSnapshot.mode, grant: privateSnapshot.grant }}
        />
      </div>
    );
  }

  const [{ data: room }, { data: chat }, groupResult] = await Promise.all([
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
    readGroupCritiqueSnapshot(id),
  ]);

  const invitees = inviteeIds.slice(0, 25).map((inviteeId) => ({
    id: inviteeId,
    name: names[inviteeId] ?? t.private.otherParticipant,
  }));

  return (
    <div className="space-y-6">
      <Link href={`/calendar/${session.id}`} className="text-link text-sm">
        {all.edit.back}
      </Link>
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">
          {!isCoach && coachName ? t.liveWith(coachName) : t.live}
        </p>
        <h1 className="mt-1 text-4xl sm:text-5xl">{session.title}</h1>
        <p className="mt-2 text-muted">
          <SessionTime
            startsAt={session.starts_at as string}
            endsAt={session.ends_at as string}
          />
        </p>
      </div>
      <GroupCritiqueGate
        sessionId={session.id as string}
        me={profile.id}
        coachId={session.coach_id as string}
        coachName={coachName ?? t.groupCritique.coach}
        canOpen={isCoach}
        canChat={isCoach || invited}
        invitees={invitees}
        initialChat={((chat ?? []) as LiveChatMessage[]).reverse()}
        initialSnapshot={groupResult.ok ? groupResult.snapshot : null}
        featureEnabled={groupResult.ok && groupResult.featureEnabled}
        legacyRoomExists={Boolean(room)}
      >
        <LiveRoom
          key={session.id as string}
          sessionId={session.id as string}
          startsAt={session.starts_at as string}
          endsAt={session.ends_at as string}
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
        {isCoach && privateMemberId && !room && (
          <PrivateOneOnOneOffer
            sessionId={session.id as string}
            memberId={privateMemberId}
            memberName={names[privateMemberId] ?? t.private.otherParticipant}
          />
        )}
        {isCoach && privateMemberId && room && (
          <p className="rounded-lg border border-border p-4 text-sm text-muted">
            {t.private.previousGroupRoom}
          </p>
        )}
        <p className="text-xs text-muted">{t.notRecorded}</p>
      </GroupCritiqueGate>
    </div>
  );
}
