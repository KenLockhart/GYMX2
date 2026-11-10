import "server-only";
import type { IntroFormat, OpenSlot } from "@/lib/intros";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Open times members can book, through the database function (no places or links).
export async function loadOpenSlots(coachId: string): Promise<OpenSlot[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("open_intro_slots", {
    target_coach_id: coachId,
  });
  return (
    (data ?? []) as {
      id: string;
      starts_at: string;
      minutes: number;
      format: IntroFormat;
    }[]
  ).map((row) => ({
    id: row.id,
    startsAt: row.starts_at,
    minutes: row.minutes,
    format: row.format,
  }));
}

export type CoachIntroSlot = {
  id: string;
  startsAt: string;
  minutes: number;
  format: IntroFormat;
  location: string;
  meetingUrl: string | null;
  upcoming: boolean;
  booking: {
    id: string;
    memberName: string;
    message: string;
    sessionId: string | null;
  } | null;
};

// A coach's own times from the last week on, with who booked each.
export async function loadCoachIntroSlots(
  coachId: string,
): Promise<CoachIntroSlot[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: slots }, { data: bookings }] = await Promise.all([
    supabase
      .from("coach_intro_slots")
      .select("id, starts_at, minutes, format, location, meeting_url")
      .eq("coach_id", coachId)
      .gte("starts_at", since)
      .order("starts_at"),
    supabase
      .from("coach_intro_bookings")
      .select("id, slot_id, member_id, message, session_id")
      .eq("coach_id", coachId)
      .eq("status", "booked"),
  ]);
  // Members who booked may not have joined yet, so their names come from the server, limited to
  // the people row security just showed this coach.
  const memberIds = [
    ...new Set((bookings ?? []).map((b) => b.member_id as string)),
  ];
  const { data: names } = memberIds.length
    ? await createAdminClient()
        .from("profiles")
        .select("id, display_name")
        .in("id", memberIds)
    : { data: [] };
  const nameOf = new Map(
    (names ?? []).map((n) => [n.id as string, n.display_name as string]),
  );
  const bySlot = new Map((bookings ?? []).map((b) => [b.slot_id as string, b]));
  return (slots ?? []).map((slot) => {
    const b = bySlot.get(slot.id as string);
    return {
      id: slot.id as string,
      startsAt: slot.starts_at as string,
      minutes: slot.minutes as number,
      format: slot.format as IntroFormat,
      location: slot.location as string,
      meetingUrl: (slot.meeting_url as string | null) ?? null,
      upcoming: new Date(slot.starts_at as string).getTime() > Date.now(),
      booking: b
        ? {
            id: b.id as string,
            memberName: nameOf.get(b.member_id as string) ?? "A member",
            message: b.message as string,
            sessionId: (b.session_id as string | null) ?? null,
          }
        : null,
    };
  });
}

export type MemberIntro = {
  id: string;
  startsAt: string;
  minutes: number;
  format: IntroFormat;
  location: string;
  meetingUrl: string | null;
  message: string;
  sessionId: string | null;
  past: boolean;
};

// The member's active intro with one coach, if any (past or upcoming).
export async function loadMyIntroWithCoach(
  memberId: string,
  coachId: string,
): Promise<MemberIntro | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("coach_intro_bookings")
    .select("id, message, session_id, slot_id")
    .eq("member_id", memberId)
    .eq("coach_id", coachId)
    .eq("status", "booked")
    .maybeSingle();
  if (!data) return null;
  // The member can't read slot rows directly, so the details come from the server for their own booking.
  const { data: slot } = await createAdminClient()
    .from("coach_intro_slots")
    .select("starts_at, minutes, format, location, meeting_url")
    .eq("id", data.slot_id as string)
    .maybeSingle();
  if (!slot) return null;
  return {
    id: data.id as string,
    startsAt: slot.starts_at as string,
    minutes: slot.minutes as number,
    format: slot.format as IntroFormat,
    location: slot.location as string,
    meetingUrl: (slot.meeting_url as string | null) ?? null,
    message: data.message as string,
    sessionId: (data.session_id as string | null) ?? null,
    past: new Date(slot.starts_at as string).getTime() < Date.now(),
  };
}
