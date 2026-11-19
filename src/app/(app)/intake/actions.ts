"use server";

import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth";
import {
  memberIntakeAnswersSchema,
  memberIntakeDraftSchema,
  validateIntakeStep,
} from "@/lib/member-intake";
import { createClient } from "@/lib/supabase/server";
import { safeMemberIntakeReturnPath } from "@/lib/member-intake-form";
import { idSchema } from "@/lib/validation";

export type IntakeActionResult = {
  error?: string;
  redirectTo?: string;
};

function textValue(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

function parseAnswers(form: FormData) {
  const value = textValue(form, "answers");
  if (value.length > 65536) return null;
  try {
    const decoded: unknown = JSON.parse(value);
    const parsed = memberIntakeDraftSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function intakePath(
  coachId: string | null,
  step: number,
  completed = false,
  returnTo: string | null = null,
) {
  const query = new URLSearchParams();
  if (coachId) query.set("coach", coachId);
  if (completed) query.set("completed", "1");
  else query.set("step", String(step));
  if (returnTo) query.set("returnTo", returnTo);
  return `/intake?${query.toString()}`;
}

function actionError(code?: string): string {
  if (code === "P0001") return "booking_unavailable";
  if (code === "42501") return "not_allowed";
  if (code === "22023") return "invalid_answers";
  return "save_failed";
}

export async function saveMemberIntakeStep(
  formData: FormData,
): Promise<IntakeActionResult> {
  const { profile } = await requireAccount();
  if (profile.role !== "member") return { error: "not_allowed" };
  const step = Number(textValue(formData, "step"));
  const direction = textValue(formData, "direction");
  const returnTo = safeMemberIntakeReturnPath(textValue(formData, "return_to"));
  const answers = parseAnswers(formData);
  if (!answers || (direction !== "next" && direction !== "back")) {
    return { error: "invalid_answers" };
  }
  const validationError = direction === "next" ? validateIntakeStep(step, answers) : null;
  if (validationError) return { error: validationError };
  if (!Number.isInteger(step) || step < 1 || step > 8) {
    return { error: "invalid_step" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_member_intake_draft", {
    p_answers: answers,
    p_current_step: direction === "next" ? Math.min(8, step + 1) : step,
  });
  if (error) return { error: actionError(error.code) };

  revalidatePath("/dashboard");
  revalidatePath("/intake");
  const coach = idSchema.safeParse(textValue(formData, "coach_id"));
  const coachId = coach.success ? coach.data : null;
  const nextStep = direction === "next" ? Math.min(8, step + 1) : Math.max(1, step - 1);
  return { redirectTo: intakePath(coachId, nextStep, false, returnTo) };
}

export async function completeMemberIntake(
  formData: FormData,
): Promise<IntakeActionResult> {
  const { profile } = await requireAccount();
  if (profile.role !== "member") return { error: "not_allowed" };

  const answers = parseAnswers(formData);
  if (!answers) return { error: "invalid_answers" };
  const parsedAnswers = memberIntakeAnswersSchema.safeParse(answers);
  if (!parsedAnswers.success) return { error: "invalid_answers" };
  const consent = textValue(formData, "consent") === "true";
  if (!consent) return { error: "consent_required" };
  const returnTo = safeMemberIntakeReturnPath(textValue(formData, "return_to"));

  const coachInput = textValue(formData, "coach_id");
  const bookingInput = textValue(formData, "booking_id");
  let coachId: string | null = null;
  let bookingId: string | null = null;
  if (coachInput || bookingInput) {
    const coach = idSchema.safeParse(coachInput);
    const booking = idSchema.safeParse(bookingInput);
    if (!coach.success || !booking.success) return { error: "booking_unavailable" };
    coachId = coach.data;
    bookingId = booking.data;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_member_intake", {
    p_answers: parsedAnswers.data,
    p_coach_id: coachId,
    p_booking_id: bookingId,
    p_consent: consent,
  });
  if (error) return { error: actionError(error.code) };

  revalidatePath("/dashboard");
  revalidatePath("/intake");
  revalidatePath("/calendar");
  revalidatePath("/members");
  if (returnTo) return { redirectTo: returnTo };
  return { redirectTo: intakePath(coachId, 1, true) };
}
