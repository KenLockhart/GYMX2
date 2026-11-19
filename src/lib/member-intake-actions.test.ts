import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAccount } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { completeMemberIntake, saveMemberIntakeStep } from "@/app/(app)/intake/actions";
import { memberIntakeAnswersSchema, memberIntakeDraftSchema } from "@/lib/member-intake";

vi.mock("@/lib/auth", () => ({ requireAccount: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const memberId = "33333333-3333-4333-8333-333333333333";
const coachId = "11111111-1111-4111-8111-111111111111";
const bookingId = "22222222-2222-4222-8222-222222222222";

const completeAnswers = {
  age: 52,
  sex: "male",
  height_in: 73,
  current_weight_lbs: 257,
  exercise_clearance: "yes",
  training_location: "commercial_gym",
  training_days_per_week: 3,
  session_minutes: 45,
  work_type: "desk",
  sleep_hours: 7.5,
  sugary_drinks_per_day: "0",
  eating_pattern: ["regular_meals"],
  activity_level: "light",
  dietary_style: "no_preference",
  batch_cooking: "once_weekly",
  meals_per_day: "3",
  plan_style: "in_between",
  checkin_preference: "none",
  stress_level: 4,
  main_why: "health",
} as const;

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("member intake server actions", () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAccount).mockResolvedValue({
      profile: { id: memberId, role: "member" },
    } as never);
    rpc.mockResolvedValue({ data: "44444444-4444-4444-8444-444444444444", error: null });
    vi.mocked(createClient).mockResolvedValue({ rpc } as never);
  });

  it("validates required fields before moving forward", async () => {
    const result = await saveMemberIntakeStep(form({
      answers: JSON.stringify({}),
      step: "1",
      direction: "next",
      coach_id: coachId,
      booking_id: bookingId,
    }));

    expect(result.error).toBe("required_fields");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("saves a partial draft when moving Back and returns the previous step", async () => {
    const answers = { age: 52 };
    const result = await saveMemberIntakeStep(form({
      answers: JSON.stringify(answers),
      step: "3",
      direction: "back",
      coach_id: coachId,
      booking_id: bookingId,
    }));

    expect(rpc).toHaveBeenCalledWith("save_member_intake_draft", {
      p_answers: memberIntakeDraftSchema.parse(answers),
      p_current_step: 3,
    });
    expect(result.redirectTo).toBe(`/intake?coach=${coachId}&step=2`);
  });

  it("preserves a safe return path across saved steps", async () => {
    const returnTo = `/calendar/${bookingId}/live`;
    const result = await saveMemberIntakeStep(form({
      answers: JSON.stringify({ age: 52 }),
      step: "3",
      direction: "back",
      coach_id: coachId,
      booking_id: bookingId,
      return_to: returnTo,
    }));

    expect(result.redirectTo).toBe(
      `/intake?coach=${coachId}&step=2&returnTo=${encodeURIComponent(returnTo)}`,
    );
  });

  it("requires final consent before creating a new coach grant", async () => {
    const result = await completeMemberIntake(form({
      answers: JSON.stringify(completeAnswers),
      coach_id: coachId,
      booking_id: bookingId,
      consent: "false",
    }));

    expect(result.error).toBe("consent_required");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends the exact coach and first booking pair only after explicit consent", async () => {
    const result = await completeMemberIntake(form({
      answers: JSON.stringify(completeAnswers),
      coach_id: coachId,
      booking_id: bookingId,
      consent: "true",
    }));

    expect(rpc).toHaveBeenCalledWith("complete_member_intake", {
      p_answers: memberIntakeAnswersSchema.parse(completeAnswers),
      p_coach_id: coachId,
      p_booking_id: bookingId,
      p_consent: true,
    });
    expect(result.redirectTo).toBe(`/intake?coach=${coachId}&completed=1`);
  });

  it("returns to the guarded session route after a newly granted coach is confirmed", async () => {
    const returnTo = `/calendar/${bookingId}/join`;
    const result = await completeMemberIntake(form({
      answers: JSON.stringify(completeAnswers),
      coach_id: coachId,
      booking_id: bookingId,
      consent: "true",
      return_to: returnTo,
    }));

    expect(rpc).toHaveBeenCalledWith("complete_member_intake", expect.objectContaining({
      p_coach_id: coachId,
      p_booking_id: bookingId,
      p_consent: true,
    }));
    expect(result.redirectTo).toBe(returnTo);
  });

  it("ignores an external return URL after intake completion", async () => {
    const result = await completeMemberIntake(form({
      answers: JSON.stringify(completeAnswers),
      coach_id: coachId,
      booking_id: bookingId,
      consent: "true",
      return_to: "https://evil.example",
    }));

    expect(result.redirectTo).toBe(`/intake?coach=${coachId}&completed=1`);
  });
});
