"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { syncProgressQuietly } from "@/lib/achievements-data";
import { requireAccount } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";
import { idSchema, memoSchema } from "@/lib/validation";

export async function saveMemo(_: ActionState, formData: FormData): Promise<ActionState> {
  const { profile } = await requireAccount();

  const parsed = memoSchema.safeParse({
    id: formData.get("id") ?? "",
    memo_date: formData.get("memo_date"),
    body: formData.get("body"),
    shared_with_coaches: formData.get("shared_with_coaches") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { id, ...fields } = parsed.data;
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("memos").update(fields).eq("id", id).eq("user_id", profile.id)
    : await supabase.from("memos").insert({ ...fields, user_id: profile.id });
  if (error) return { error: "We couldn't save that Memo. Please try again." };

  after(() => syncProgressQuietly(profile));
  revalidatePath("/memos");
  redirect("/memos");
}

export async function deleteMemo(_: ActionState, formData: FormData): Promise<ActionState> {
  const { profile } = await requireAccount();
  const memoId = idSchema.safeParse(formData.get("id"));
  if (!memoId.success) return { error: "Choose a Memo." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("memos")
    .delete()
    .eq("id", memoId.data)
    .eq("user_id", profile.id);
  if (error) return { error: "We couldn't delete that Memo. Please try again." };

  revalidatePath("/memos");
  return {};
}
