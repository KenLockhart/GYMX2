"use server";

import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth";
import { todayKey } from "@/lib/reminders";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

export type DailyFuelAssignmentState =
  | { status: "idle" }
  | { status: "assigned" }
  | {
      status: "error";
      reason: "not_ready" | "not_allowed" | "day_changed" | "failed";
    };

export async function assignMemberDailyFuelVideo(
  _previous: DailyFuelAssignmentState,
  formData: FormData,
): Promise<DailyFuelAssignmentState> {
  const { profile } = await requireAccount();
  if (profile.role !== "coach" && profile.role !== "admin")
    return { status: "error", reason: "not_allowed" };

  const videoId = idSchema.safeParse(formData.get("video_id"));
  const memberId = idSchema.safeParse(formData.get("member_id"));
  if (!videoId.success || !memberId.success)
    return { status: "error", reason: "failed" };

  let error: { code?: string } | null = null;
  try {
    const supabase = await createClient();
    ({ error } = await supabase.rpc("assign_member_daily_fuel_video", {
      target_member_id: memberId.data,
      target_video_id: videoId.data,
      target_expected_day: todayKey(),
    }));
  } catch {
    return { status: "error", reason: "failed" };
  }
  if (error) {
    if (error.code === "22023")
      return { status: "error", reason: "not_ready" };
    if (error.code === "P0001")
      return { status: "error", reason: "day_changed" };
    if (error.code === "42501")
      return { status: "error", reason: "not_allowed" };
    return { status: "error", reason: "failed" };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/library/${videoId.data}`);
  return { status: "assigned" };
}
