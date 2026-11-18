import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getPlatformEntitlement } from "@/lib/platform-membership-server";
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

// Use this only for the app shell, the membership flow, account/privacy/export/deletion, billing
// management, My Purchases, and an owned paid download. Member features use requireAccount below.
export async function requireAuthenticatedAccount() {
  const account = await getCurrentAccount();
  if (!account) redirect("/login");
  return account;
}

export async function requireAccount() {
  const account = await requireAuthenticatedAccount();
  if (account.profile.role === "member") {
    const access = await getPlatformEntitlement(account.profile.id);
    if (!access.ok) redirect("/membership?issue=check");
    if (!access.entitlement) redirect("/membership?issue=required");
  }
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
