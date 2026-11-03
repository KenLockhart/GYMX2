"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";
import { setRoleSchema } from "@/lib/validation";

export async function setUserRole(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();

  const parsed = setRoleSchema.safeParse({
    user_id: formData.get("user_id"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: "Choose a valid role." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_user_role", {
    target_user_id: parsed.data.user_id,
    new_role: parsed.data.role,
  });
  if (error) {
    return {
      error: error.code === "P0001" ? error.message : "We couldn't change that role. Please try again.",
    };
  }

  revalidatePath("/", "layout");
  return { message: "Saved." };
}
