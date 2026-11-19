import type { MemberIntakeDraft } from "@/lib/member-intake";
import { idSchema } from "@/lib/validation";

export type IntakeFormCoach = {
  coachId: string;
  bookingId: string;
} | null;

export function safeMemberIntakeReturnPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^\/calendar\/([^/?#]+)(?:\/(live|join))?$/.exec(value);
  if (!match || !idSchema.safeParse(match[1]).success) return null;
  return `/calendar/${match[1]}${match[2] ? `/${match[2]}` : ""}`;
}

export function prepareMemberIntakeFormData(
  formData: FormData,
  input: {
    answers: MemberIntakeDraft;
    step: number;
    coach: IntakeFormCoach;
    consent: boolean;
    submitterValue: string | null;
    returnTo?: string | null;
  },
) {
  formData.set("answers", JSON.stringify(input.answers));
  formData.set("step", String(input.step));
  // Enter submits the first DOM submit button, which is the forward action.
  formData.set("direction", input.submitterValue === "back" ? "back" : "next");
  formData.set("coach_id", input.coach?.coachId ?? "");
  formData.set("booking_id", input.coach?.bookingId ?? "");
  formData.set("consent", input.consent ? "true" : "false");
  formData.set("return_to", safeMemberIntakeReturnPath(input.returnTo) ?? "");
  return formData;
}
