"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAccount } from "@/lib/auth";
import {
  introErrorMessage,
  introMessageSchema,
  introSlotsSchema,
} from "@/lib/intros";
import { notifyIntro } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

type Result = { error?: string };

// Coaches publish intro times. Row security checks the times are theirs and in the future.
export async function addIntroSlots(input: {
  starts: string[];
  minutes: number | string;
  format: string;
  location: string;
  meetingUrl: string;
}): Promise<Result & { added?: number }> {
  const { profile } = await requireAccount();
  if (profile.role !== "coach")
    return { error: "Only coaches can offer intros." };
  const parsed = introSlotsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const soon = Date.now() + 60 * 60 * 1000;
  const starts = [...new Set(parsed.data.starts)].filter(
    (iso) => new Date(iso).getTime() > soon,
  );
  if (!starts.length) return { error: "Pick times at least an hour from now." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("coach_intro_slots")
    .upsert(
      starts.map((starts_at) => ({
        coach_id: profile.id,
        starts_at,
        minutes: parsed.data.minutes,
        format: parsed.data.format,
        location: parsed.data.location,
        meeting_url: parsed.data.meetingUrl || null,
      })),
      { onConflict: "coach_id,starts_at", ignoreDuplicates: true },
    )
    .select("id");
  if (error)
    return {
      error:
        error.code === "42501"
          ? "Times must be in the next 120 days."
          : "We couldn't add those times. Please try again.",
    };
  revalidatePath("/calendar/intros");
  return { added: data?.length ?? 0 };
}

export async function removeIntroSlot(slotId: string): Promise<Result> {
  await requireAccount();
  const id = idSchema.safeParse(slotId);
  if (!id.success) return { error: "Time not found." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("coach_intro_slots")
    .delete()
    .eq("id", id.data)
    .select("id");
  if (error)
    return { error: "We couldn't remove that time. Please try again." };
  if (!data?.length)
    return { error: "Someone has booked that time. Cancel the intro first." };
  revalidatePath("/calendar/intros");
  return {};
}

// A member books a free intro. The database checks the time is open and applies the limits.
export async function bookIntro(
  slotId: string,
  message: string,
): Promise<Result & { sessionId?: string | null }> {
  const { profile } = await requireAccount();
  if (profile.role !== "member")
    return { error: "Only members can book an intro." };
  const id = idSchema.safeParse(slotId);
  if (!id.success) return { error: "That time isn't available any more." };
  const text = introMessageSchema.safeParse(message ?? "");
  if (!text.success) return { error: text.error.issues[0].message };

  const supabase = await createClient();
  const { data: bookingId, error } = await supabase.rpc("book_intro", {
    target_slot_id: id.data,
    intro_message: text.data,
  });
  if (error || !bookingId) return { error: introErrorMessage(error?.message) };
  after(() => notifyIntro(bookingId as string, "booked"));

  const { data: booking } = await supabase
    .from("coach_intro_bookings")
    .select("session_id")
    .eq("id", bookingId as string)
    .maybeSingle();
  revalidatePath("/calendar");
  return { sessionId: (booking?.session_id as string | null) ?? null };
}

// Either person cancels. The time opens up again for someone else.
export async function cancelIntro(bookingId: string): Promise<Result> {
  await requireAccount();
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return { error: "Intro not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_intro", {
    target_booking_id: id.data,
  });
  if (error) return { error: introErrorMessage(error.message) };
  after(() => notifyIntro(id.data, "cancelled"));
  revalidatePath("/calendar");
  revalidatePath("/calendar/intros");
  return {};
}
