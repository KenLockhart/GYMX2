"use server";

import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth";
import { todayKey } from "@/lib/reminders";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";
import { z } from "zod";

export type DailyFuelActionResult =
  | { ok: true; value: boolean }
  | { ok: false; error: "not_allowed" | "day_changed" | "failed" };

export async function setMemberDailyAffirmation(
  day: string,
  revisionId: string,
  affirmed: boolean,
): Promise<DailyFuelActionResult> {
  const { profile } = await requireAccount();
  if (profile.role !== "member") return { ok: false, error: "not_allowed" };
  const parsedRevisionId = idSchema.safeParse(revisionId);
  if (!parsedRevisionId.success || typeof affirmed !== "boolean")
    return { ok: false, error: "failed" };
  const parsedDay = z.iso.date().safeParse(day);
  if (!parsedDay.success || day !== todayKey())
    return { ok: false, error: "day_changed" };

  try {
    const supabase = await createClient();
    const result = await supabase.rpc("set_member_daily_content_acknowledgment", {
      target_expected_day: day,
      target_revision_id: parsedRevisionId.data,
      target_acknowledged: affirmed,
    });
    if (result.error)
      return {
        ok: false,
        error: result.error.code === "P0001" ? "day_changed" : "failed",
      };
    if (result.data !== affirmed) return { ok: false, error: "failed" };
  } catch {
    return { ok: false, error: "failed" };
  }
  revalidatePath("/dashboard");
  return { ok: true, value: affirmed };
}

export async function setMemberDailyFuelBookmark(
  videoId: string,
  saved: boolean,
): Promise<DailyFuelActionResult> {
  const { profile } = await requireAccount();
  if (profile.role !== "member") return { ok: false, error: "not_allowed" };
  if (typeof saved !== "boolean") return { ok: false, error: "failed" };
  const parsedVideoId = idSchema.safeParse(videoId);
  if (!parsedVideoId.success) return { ok: false, error: "failed" };

  let data: unknown;
  try {
    const supabase = await createClient();
    const result = await supabase.rpc("set_member_daily_fuel_bookmark", {
      target_video_id: parsedVideoId.data,
      target_saved: saved,
    });
    if (result.error)
      return {
        ok: false,
        error: result.error.code === "42501" ? "not_allowed" : "failed",
      };
    data = result.data;
  } catch {
    return { ok: false, error: "failed" };
  }
  revalidatePath("/dashboard");
  return { ok: true, value: data === true };
}
