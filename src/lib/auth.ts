import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export const getCurrentAccount = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  return profile ? { email: user.email ?? "", profile } : null;
});

export async function requireAccount() {
  const account = await getCurrentAccount();
  if (!account) redirect("/login");
  return account;
}

export async function requireCoach() {
  const account = await requireAccount();
  if (account.profile.role !== "coach") redirect("/dashboard");
  return account;
}

export async function requireAdmin() {
  const account = await requireAccount();
  if (account.profile.role !== "admin") redirect("/dashboard");
  return account;
}

// People who review reports: moderators (shared feed), coaches (their own community) and admins.
export async function requireModerator() {
  const account = await requireAccount();
  if (!["moderator", "coach", "admin"].includes(account.profile.role))
    redirect("/dashboard");
  return account;
}

// Coaches sell to their members; admins can add GYMX2's own items.
export async function requireCoachOrAdmin() {
  const account = await requireAccount();
  if (account.profile.role !== "coach" && account.profile.role !== "admin")
    redirect("/dashboard");
  return account;
}
