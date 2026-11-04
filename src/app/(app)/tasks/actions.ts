"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccount, requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";
import { idSchema, taskSchema } from "@/lib/validation";

export async function createTask(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireCoach();

  const parsed = taskSchema.safeParse({
    video_id: formData.get("video_id"),
    title: formData.get("title"),
    instructions: formData.get("instructions"),
    due_on: formData.get("due_on"),
    member_ids: formData.getAll("member_ids"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_task", {
    target_video_id: parsed.data.video_id,
    task_title: parsed.data.title,
    task_instructions: parsed.data.instructions,
    task_due_on: parsed.data.due_on,
    target_member_ids: parsed.data.member_ids,
  });
  if (error) {
    return {
      error: error.code === "P0001" ? error.message : "We couldn't save that Task. Please try again.",
    };
  }

  revalidatePath("/tasks");
  redirect("/tasks");
}

export async function deleteTask(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireCoach();
  const taskId = idSchema.safeParse(formData.get("task_id"));
  if (!taskId.success) return { error: "Choose a Task." };

  const supabase = await createClient();
  const { error } = await supabase.from("tasks").delete().eq("id", taskId.data);
  if (error) return { error: "We couldn't delete that Task. Please try again." };

  revalidatePath("/tasks");
  return {};
}

export async function setTaskCompleted(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireAccount();
  const assignmentId = idSchema.safeParse(formData.get("assignment_id"));
  if (!assignmentId.success) return { error: "Choose a Task." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_assignment_completed", {
    target_assignment_id: assignmentId.data,
    is_done: formData.get("is_done") === "true",
  });
  if (error) return { error: "We couldn't update that Task. Please try again." };

  revalidatePath("/tasks");
  return {};
}
