"use server";

import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth";
import {
  dailyContentSlotInputSchema,
  isValidDailyContentScheduleDay,
  parseDailyContentForm,
  type DailyContentActionState,
} from "@/lib/daily-content";
import { todayKey } from "@/lib/reminders";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

const idle: DailyContentActionState = { status: "idle" };

function actionError(code: string | undefined): DailyContentActionState {
  if (code === "42501") return { status: "error", reason: "not_allowed" };
  if (code === "P0001") return { status: "error", reason: "day_changed" };
  if (code === "P0002") return { status: "error", reason: "not_found" };
  if (code === "22023" || code === "55000") return { status: "error", reason: "not_ready" };
  return { status: "error", reason: "failed" };
}

function canManage(role: string) {
  return role === "coach" || role === "admin";
}

async function refreshDailyContent() {
  revalidatePath("/library/daily-content");
  revalidatePath("/admin/daily-content");
  revalidatePath("/dashboard");
  revalidatePath("/library");
}

export async function saveDailyContentItem(
  _previous: DailyContentActionState = idle,
  formData: FormData,
): Promise<DailyContentActionState> {
  void _previous;
  const { profile } = await requireAccount();
  if (!canManage(profile.role)) return { status: "error", reason: "not_allowed" };

  const parsed = parseDailyContentForm(formData);
  if (!parsed.success) return { status: "error", reason: "invalid" };
  try {
    const supabase = await createClient();
    const result = await supabase.rpc("save_daily_content_item", {
      target_item_id: parsed.data.itemId,
      target_kind: parsed.data.kind,
      target_title: parsed.data.title,
      target_video_id: parsed.data.videoId,
      target_quote_text: parsed.data.kind === "quote" ? parsed.data.quoteText : null,
      target_quote_attribution:
        parsed.data.kind === "quote" ? parsed.data.quoteAttribution || null : null,
      target_affirmation_text:
        parsed.data.kind === "affirmation" ? parsed.data.affirmationText : null,
    });
    if (result.error) return actionError(result.error.code);
    if (!result.data?.length) return { status: "error", reason: "failed" };
  } catch {
    return { status: "error", reason: "failed" };
  }
  await refreshDailyContent();
  return { status: "saved" };
}

export async function publishDailyContentSlot(
  _previous: DailyContentActionState = idle,
  formData: FormData,
): Promise<DailyContentActionState> {
  void _previous;
  const { profile } = await requireAccount();
  if (!canManage(profile.role)) return { status: "error", reason: "not_allowed" };
  const parsed = dailyContentSlotInputSchema.safeParse({
    itemId: formData.get("item_id"),
    revisionId: formData.get("revision_id"),
    day: formData.get("day"),
  });
  if (!parsed.success || !isValidDailyContentScheduleDay(parsed.data?.day ?? "", todayKey()))
    return { status: "error", reason: "invalid" };
  try {
    const supabase = await createClient();
    const result = await supabase.rpc("publish_daily_content_slot", {
      target_item_id: parsed.data.itemId,
      target_revision_id: parsed.data.revisionId,
      target_day: parsed.data.day,
    });
    if (result.error) return actionError(result.error.code);
    if (!result.data) return { status: "error", reason: "failed" };
  } catch {
    return { status: "error", reason: "failed" };
  }
  await refreshDailyContent();
  return { status: "published" };
}

export async function archiveDailyContentItem(
  _previous: DailyContentActionState = idle,
  formData: FormData,
): Promise<DailyContentActionState> {
  void _previous;
  const { profile } = await requireAccount();
  if (!canManage(profile.role)) return { status: "error", reason: "not_allowed" };
  const itemId = idSchema.safeParse(formData.get("item_id"));
  if (!itemId.success) return { status: "error", reason: "invalid" };
  try {
    const supabase = await createClient();
    const result = await supabase.rpc("archive_daily_content_item", {
      target_item_id: itemId.data,
    });
    if (result.error) return actionError(result.error.code);
    if (result.data !== true) return { status: "error", reason: "not_found" };
  } catch {
    return { status: "error", reason: "failed" };
  }
  await refreshDailyContent();
  return { status: "archived" };
}

export async function cancelDailyContentSlot(
  _previous: DailyContentActionState = idle,
  formData: FormData,
): Promise<DailyContentActionState> {
  void _previous;
  const { profile } = await requireAccount();
  if (!canManage(profile.role)) return { status: "error", reason: "not_allowed" };
  const slotId = idSchema.safeParse(formData.get("slot_id"));
  if (!slotId.success) return { status: "error", reason: "invalid" };
  try {
    const supabase = await createClient();
    const result = await supabase.rpc("cancel_daily_content_slot", {
      target_slot_id: slotId.data,
    });
    if (result.error) return actionError(result.error.code);
    if (result.data !== true) return { status: "error", reason: "not_found" };
  } catch {
    return { status: "error", reason: "failed" };
  }
  await refreshDailyContent();
  return { status: "cancelled" };
}

export async function acknowledgeDailyContentAffirmation(
  day: string,
  revisionId: string,
  acknowledged: boolean,
): Promise<{ ok: true; acknowledged: boolean } | { ok: false; reason: "not_allowed" | "day_changed" | "failed" }> {
  const { profile } = await requireAccount();
  if (profile.role !== "member") return { ok: false, reason: "not_allowed" };
  if (!idSchema.safeParse(revisionId).success || typeof acknowledged !== "boolean")
    return { ok: false, reason: "failed" };
  if (day !== todayKey()) return { ok: false, reason: "day_changed" };
  try {
    const supabase = await createClient();
    const result = await supabase.rpc("set_member_daily_content_acknowledgment", {
      target_expected_day: day,
      target_revision_id: revisionId,
      target_acknowledged: acknowledged,
    });
    if (result.error) {
      return {
        ok: false,
        reason: result.error.code === "42501" ? "not_allowed" :
          result.error.code === "P0001" ? "day_changed" : "failed",
      };
    }
    if (result.data !== acknowledged) return { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
  revalidatePath("/dashboard");
  return { ok: true, acknowledged };
}
