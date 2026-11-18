"use server";

import { revalidatePath } from "next/cache";
import { getT } from "@/i18n/server";
import { requireAccount } from "@/lib/auth";
import {
  dailyCheckinExpectedDaySchema,
  dailyCheckinSchema,
} from "@/lib/daily-checkins";
import { todayKey } from "@/lib/reminders";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

export async function saveDailyCheckin(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireAccount();
  const copy = (await getT()).checkin.daily;
  if (profile.role !== "member") return { error: copy.memberOnly };

  const expectedDay = dailyCheckinExpectedDaySchema.safeParse(
    formData.get("expected_day"),
  );
  if (!expectedDay.success || expectedDay.data !== todayKey())
    return { error: copy.stale };

  const parsed = dailyCheckinSchema.safeParse({
    energy: formData.get("energy") ?? 0,
    sleep: formData.get("sleep") ?? 0,
    stress: formData.get("stress") ?? 0,
    motivation: formData.get("motivation") ?? 0,
  });
  if (!parsed.success) return { error: copy.invalidAnswers };

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_member_daily_checkin", {
    target_expected_day: expectedDay.data,
    target_energy: parsed.data.energy,
    target_sleep: parsed.data.sleep,
    target_stress: parsed.data.stress,
    target_motivation: parsed.data.motivation,
  });
  if (error)
    return {
      error:
        error.message === "Daily check-in day changed"
          ? copy.stale
          : copy.saveError,
    };

  revalidatePath("/checkin/daily");
  revalidatePath("/dashboard");
  return { message: copy.saved };
}
