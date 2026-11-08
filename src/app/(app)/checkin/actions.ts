"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireAccount, requireCoach } from "@/lib/auth";
import {
  CHECKIN_QUESTION_MAX,
  CHECKIN_TEXT_MAX,
  weekStart,
} from "@/lib/checkins";
import { sendPush } from "@/lib/push";
import { todayKey } from "@/lib/reminders";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";
import { idSchema } from "@/lib/validation";

const score = z.coerce.number().int().min(1, "Answer every scale").max(5);
const checkinSchema = z.object({
  energy: score,
  sleep: score,
  stress: score,
  motivation: score,
  wins: z.string().trim().max(CHECKIN_TEXT_MAX),
  struggles: z.string().trim().max(CHECKIN_TEXT_MAX),
  question: z.string().trim().max(CHECKIN_QUESTION_MAX),
});

export async function saveCheckin(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireAccount();
  if (profile.role !== "member") return { error: "Check-ins are for members." };
  const parsed = checkinSchema.safeParse({
    energy: formData.get("energy") ?? 0,
    sleep: formData.get("sleep") ?? 0,
    stress: formData.get("stress") ?? 0,
    motivation: formData.get("motivation") ?? 0,
    wins: formData.get("wins") ?? "",
    struggles: formData.get("struggles") ?? "",
    question: formData.get("question") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const week = weekStart(todayKey());
  const { data: existing } = await supabase
    .from("checkins")
    .select("id")
    .eq("member_id", profile.id)
    .eq("week_start", week)
    .maybeSingle();
  const { error } = existing
    ? await supabase
        .from("checkins")
        .update({ ...parsed.data, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
    : await supabase
        .from("checkins")
        .insert({ ...parsed.data, member_id: profile.id, week_start: week });
  if (error)
    return { error: "We couldn't save your check-in. Please try again." };

  if (!existing) {
    // Let their coaches know a check-in arrived.
    after(async () => {
      const { data: coaches } = await supabase
        .from("coach_members")
        .select("coach_id")
        .eq("member_id", profile.id);
      await sendPush(
        (coaches ?? []).map((row) => row.coach_id as string),
        {
          title: `${profile.display_name} checked in`,
          body:
            parsed.data.question ||
            parsed.data.wins ||
            "See how their week went.",
          url: "/checkins",
          tag: `checkin-${profile.id}`,
        },
      );
    });
  }
  revalidatePath("/checkin");
  revalidatePath("/checkins");
  return {
    message: existing
      ? "Check-in updated."
      : "Checked in. Your coaches can see it now.",
  };
}

const replySchema = z.object({
  checkin_id: idSchema,
  body: z.string().trim().min(1, "Write a reply first").max(1000),
});

export async function replyToCheckin(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireCoach();
  const parsed = replySchema.safeParse({
    checkin_id: formData.get("checkin_id"),
    body: formData.get("body") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data: checkin } = await supabase
    .from("checkins")
    .select("member_id")
    .eq("id", parsed.data.checkin_id)
    .maybeSingle();
  if (!checkin) return { error: "That check-in wasn't found." };
  const { error } = await supabase
    .from("checkin_replies")
    .insert({
      checkin_id: parsed.data.checkin_id,
      coach_id: profile.id,
      body: parsed.data.body,
    });
  if (error) return { error: "We couldn't send your reply. Please try again." };
  after(() =>
    sendPush([checkin.member_id as string], {
      title: `${profile.display_name} replied to your check-in`,
      body: parsed.data.body,
      url: "/checkin",
      tag: "checkin-reply",
    }),
  );
  revalidatePath("/checkins");
  return { message: "Reply sent." };
}

export async function deleteCheckinReply(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireCoach();
  const id = idSchema.safeParse(formData.get("reply_id"));
  if (!id.success) return { error: "That reply wasn't found." };
  const supabase = await createClient();
  await supabase.from("checkin_replies").delete().eq("id", id.data);
  revalidatePath("/checkins");
  return {};
}
