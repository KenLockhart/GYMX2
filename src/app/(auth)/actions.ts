"use server";

import { redirect } from "next/navigation";
import { getSiteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";
import {
  emailSchema,
  newPasswordSchema,
  safeRedirectPath,
  signInSchema,
  signUpSchema,
} from "@/lib/validation";

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function signIn(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signInSchema.safeParse({
    email: text(formData, "email"),
    password: text(formData, "password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "That email and password didn't match, or the email isn't confirmed yet." };

  redirect(safeRedirectPath(text(formData, "next")));
}

export async function signUp(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signUpSchema.safeParse({
    display_name: text(formData, "display_name"),
    email: text(formData, "email"),
    password: text(formData, "password"),
    coach_requested: formData.get("coach_requested") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { display_name, email, password, coach_requested } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name, coach_requested: String(coach_requested) },
      emailRedirectTo: `${getSiteUrl()}/auth/confirm?next=/dashboard`,
    },
  });
  if (error) return { error: "We couldn't create that account. Check your details or try logging in." };

  if (data.session) redirect("/dashboard");
  return { message: "Check your email for a link to confirm your account." };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function requestPasswordReset(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = emailSchema.safeParse({ email: text(formData, "email") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${getSiteUrl()}/auth/confirm?next=/reset-password`,
  });

  // The same reply either way, so this form can't reveal who has an account.
  return { message: "If that email has an account, a reset link is on its way." };
}

export async function updatePassword(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = newPasswordSchema.safeParse({ password: text(formData, "password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser(parsed.data);
  if (error) return { error: "We couldn't update your password. Request a new reset link and try again." };

  redirect("/dashboard");
}
