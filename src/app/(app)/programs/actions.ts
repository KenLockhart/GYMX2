"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { isPillar } from "@/lib/achievements";
import { syncProgressQuietly } from "@/lib/achievements-data";
import { requireAccount, requireCoachOrAdmin } from "@/lib/auth";
import { canUseProgramIntroVideo } from "@/lib/programs";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";
import { idSchema } from "@/lib/validation";

function text(formData: FormData, name: string, max: number) {
  return String(formData.get(name) ?? "")
    .trim()
    .slice(0, max);
}

function introVideoId(formData: FormData) {
  const value = String(formData.get("intro_video_id") ?? "");
  if (!value) return { success: true as const, data: null };
  const parsed = idSchema.safeParse(value);
  return parsed.success
    ? { success: true as const, data: parsed.data }
    : { success: false as const };
}

async function ownedReadyProgramVideo(
  profileId: string,
  videoId: string | null,
) {
  if (!videoId) return true;
  const supabase = await createClient();
  const { data } = await supabase
    .from("videos")
    .select("id, coach_id, status")
    .eq("id", videoId)
    .eq("coach_id", profileId)
    .eq("status", "ready")
    .maybeSingle();
  return canUseProgramIntroVideo(
    data
      ? {
          id: data.id,
          creatorId: data.coach_id,
          status: data.status,
        }
      : null,
    profileId,
  );
}

function ownsProgramForRole(
  profile: { id: string; role: string },
  program: { coach_id: string; platform_owned: boolean } | null,
) {
  if (!program || program.coach_id !== profile.id) return false;
  return profile.role === "admin"
    ? program.platform_owned
    : profile.role === "coach" && !program.platform_owned;
}

export async function createProgram(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireCoachOrAdmin();
  const title = text(formData, "title", 120);
  if (!title) return { error: "Name the program." };
  const intro = introVideoId(formData);
  if (!intro.success) return { error: "Choose one of your videos." };
  if (!(await ownedReadyProgramVideo(profile.id, intro.data))) {
    return { error: "Choose one of your videos that has finished processing" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("programs")
    .insert({
      coach_id: profile.id,
      title,
      description: text(formData, "description", 2000),
      platform_owned: profile.role === "admin",
      intro_video_id: intro.data,
    })
    .select("id")
    .single();
  if (error || !data)
    return { error: "We couldn't create that program. Please try again." };
  redirect(`/programs/${data.id}`);
}

export async function updateProgram(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireCoachOrAdmin();
  const id = idSchema.safeParse(formData.get("program_id"));
  const title = text(formData, "title", 120);
  if (!id.success || !title) return { error: "Name the program." };
  const intro = introVideoId(formData);
  if (!intro.success) return { error: "Choose one of your videos." };
  if (!(await ownedReadyProgramVideo(profile.id, intro.data))) {
    return { error: "Choose one of your videos that has finished processing" };
  }
  const publish = formData.get("published") === "on";
  const supabase = await createClient();
  const { data: program } = await supabase
    .from("programs")
    .select("coach_id, platform_owned")
    .eq("id", id.data)
    .maybeSingle();
  if (!ownsProgramForRole(profile, program))
    return { error: "We couldn't save that program. Please try again." };
  if (publish) {
    const { count } = await supabase
      .from("program_days")
      .select("id", { count: "exact", head: true })
      .eq("program_id", id.data);
    if (!count) return { error: "Add at least one day before publishing." };
  }
  const { error } = await supabase
    .from("programs")
    .update({
      title,
      description: text(formData, "description", 2000),
      published: publish,
      intro_video_id: intro.data,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id.data)
    .eq("coach_id", profile.id);
  if (error)
    return { error: "We couldn't save the program. Please try again." };
  revalidatePath(`/programs/${id.data}`);
  revalidatePath("/programs");
  return {
    message: publish
      ? "Saved and published. Your members can start it."
      : "Saved.",
  };
}

export async function deleteProgram(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireCoachOrAdmin();
  const id = idSchema.safeParse(formData.get("program_id"));
  if (!id.success) return { error: "Choose a program." };
  const supabase = await createClient();
  const { error } = await supabase
    .rpc("delete_owned_program", { target_program_id: id.data });
  if (error)
    return { error: "We couldn't delete the program. Please try again." };
  revalidatePath("/programs");
  redirect("/programs");
}

export async function saveProgramDay(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireCoachOrAdmin();
  const programId = idSchema.safeParse(formData.get("program_id"));
  const dayId = String(formData.get("day_id") ?? "");
  const dayNumber = Number(formData.get("day_number"));
  const title = text(formData, "title", 120);
  const pillar = formData.get("pillar");
  const videoId = String(formData.get("video_id") ?? "");
  if (!programId.success) return { error: "Choose a program." };
  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 365)
    return { error: "Use a day from 1 to 365." };
  if (!title) return { error: "Give the day a title." };
  if (!isPillar(pillar)) return { error: "Choose Mind, Body or Spirit." };
  if (videoId && !idSchema.safeParse(videoId).success)
    return { error: "Choose one of your videos." };

  const row = {
    day_number: dayNumber,
    title,
    instructions: text(formData, "instructions", 2000),
    pillar,
    video_id: videoId || null,
  };
  const supabase = await createClient();
  const { data: program } = await supabase
    .from("programs")
    .select("coach_id, platform_owned")
    .eq("id", programId.data)
    .maybeSingle();
  if (!ownsProgramForRole(profile, program))
    return { error: "We couldn't save that day." };
  if (row.video_id && !(await ownedReadyProgramVideo(profile.id, row.video_id))) {
    return { error: "Choose one of your ready videos." };
  }
  const parsedDayId = dayId ? idSchema.safeParse(dayId) : null;
  if (dayId && !parsedDayId?.success) return { error: "Choose a day." };
  const { error } = await supabase.rpc("save_owned_program_day", {
    target_program_id: programId.data,
    target_day_id: parsedDayId?.success ? parsedDayId.data : null,
    target_day_number: row.day_number,
    target_title: row.title,
    target_instructions: row.instructions,
    target_pillar: row.pillar,
    target_video_id: row.video_id,
  });
  if (error) {
    return {
      error:
        error.code === "23505"
          ? `Day ${dayNumber} already exists. Pick another number.`
          : "We couldn't save that day.",
    };
  }
  revalidatePath(`/programs/${programId.data}`);
  return { message: "Saved." };
}

export async function deleteProgramDay(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireCoachOrAdmin();
  const dayId = idSchema.safeParse(formData.get("day_id"));
  const programId = idSchema.safeParse(formData.get("program_id"));
  if (!dayId.success || !programId.success) return { error: "Choose a day." };
  const supabase = await createClient();
  const { data: program } = await supabase
    .from("programs")
    .select("coach_id, platform_owned")
    .eq("id", programId.data)
    .maybeSingle();
  if (!ownsProgramForRole(profile, program))
    return { error: "We couldn't remove that day." };
  const { error } = await supabase.rpc("delete_owned_program_day", {
    target_program_id: programId.data,
    target_day_id: dayId.data,
  });
  if (error) return { error: "We couldn't remove that day." };
  revalidatePath(`/programs/${programId.data}`);
  return {};
}

export async function startProgram(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAccount();
  const id = idSchema.safeParse(formData.get("program_id"));
  if (!id.success) return { error: "Choose a program." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_my_program_enrollment", {
    target_program_id: id.data,
  });
  if (error)
    return { error: "We couldn't start that program. Please try again." };
  revalidatePath("/programs");
  redirect(`/programs/${id.data}`);
}

export async function leaveProgram(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAccount();
  const id = idSchema.safeParse(formData.get("enrollment_id"));
  if (!id.success) return { error: "Choose a program." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("leave_my_program_enrollment", {
    target_enrollment_id: id.data,
  });
  if (error)
    return { error: "We couldn't leave that program. Please try again." };
  revalidatePath("/programs");
  redirect("/programs");
}

// Marks a day done (or not). The database checks the day has unlocked.
export async function setProgramDayDone(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireAccount();
  const dayId = idSchema.safeParse(formData.get("day_id"));
  const operationId = idSchema.safeParse(formData.get("operation_id"));
  const programId = idSchema.safeParse(formData.get("program_id"));
  const doneValue = formData.get("done");
  if (!dayId.success || !operationId.success || !programId.success || (doneValue !== "true" && doneValue !== "false"))
    return { error: "Choose a day." };
  const isDone = doneValue === "true";

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_my_program_lesson_state", {
    target_program_id: programId.data,
    target_lesson_id: dayId.data,
    target_done: isDone,
    target_operation_id: operationId.data,
  });
  if (error) {
    return {
      error:
        error.code === "42501"
          ? "That day hasn't unlocked yet."
          : "We couldn't save that. Please try again.",
    };
  }
  if (!data || typeof data !== "object" || !("accepted" in data) || data.accepted !== true) {
    return { error: "We couldn't save that. Please try again." };
  }
  if (isDone && data.replayed !== true && data.current_completed === true) {
    after(() => syncProgressQuietly(profile));
  }
  revalidatePath(`/programs/${programId.data}`);
  return { message: "Saved." };
}
