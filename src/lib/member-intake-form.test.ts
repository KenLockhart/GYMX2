import { describe, expect, it } from "vitest";
import {
  prepareMemberIntakeFormData,
  safeMemberIntakeReturnPath,
} from "@/lib/member-intake-form";

const coach = {
  coachId: "11111111-1111-4111-8111-111111111111",
  bookingId: "22222222-2222-4222-8222-222222222222",
};

describe("member intake form action contract", () => {
  it.each([
    ["next", "next"],
    ["back", "back"],
    [null, "next"],
  ] as const)("serializes %s as the %s action", (submitterValue, direction) => {
    const formData = prepareMemberIntakeFormData(new FormData(), {
      answers: { age: 52, current_weight_lbs: 257 },
      step: 4,
      coach,
      consent: false,
      submitterValue,
    });

    expect(formData.get("answers")).toBe('{"age":52,"current_weight_lbs":257}');
    expect(formData.get("step")).toBe("4");
    expect(formData.get("direction")).toBe(direction);
    expect(formData.get("coach_id")).toBe(coach.coachId);
    expect(formData.get("booking_id")).toBe(coach.bookingId);
    expect(formData.get("consent")).toBe("false");
    expect(formData.get("return_to")).toBe("");
  });

  it("retains a safe in-app return path across Back and forward saves", () => {
    const returnTo = "/calendar/44444444-4444-4444-8444-444444444444/live";
    const formData = prepareMemberIntakeFormData(new FormData(), {
      answers: { age: 52 },
      step: 3,
      coach,
      consent: false,
      submitterValue: "back",
      returnTo,
    });

    expect(formData.get("return_to")).toBe(returnTo);
  });

  it.each([
    ["/calendar/44444444-4444-4444-8444-444444444444/live", "/calendar/44444444-4444-4444-8444-444444444444/live"],
    ["/calendar/44444444-4444-4444-8444-444444444444/join", "/calendar/44444444-4444-4444-8444-444444444444/join"],
    ["https://evil.example", null],
    ["//evil.example/calendar/44444444-4444-4444-8444-444444444444/live", null],
    ["/calendar/44444444-4444-4444-8444-444444444444/live?other=1", null],
  ])("validates return path %s", (value, expected) => {
    expect(safeMemberIntakeReturnPath(value)).toBe(expected);
  });

  it("keeps final submit consent and coach binding in the real FormData payload", () => {
    const formData = prepareMemberIntakeFormData(new FormData(), {
      answers: { age: 52, exercise_clearance: "yes" },
      step: 8,
      coach,
      consent: true,
      submitterValue: "finish",
      returnTo: "/calendar/44444444-4444-4444-8444-444444444444/join",
    });

    expect(formData.get("consent")).toBe("true");
    expect(formData.get("coach_id")).toBe(coach.coachId);
    expect(formData.get("booking_id")).toBe(coach.bookingId);
    expect(formData.get("return_to")).toBe("/calendar/44444444-4444-4444-8444-444444444444/join");
  });

  it("round-trips optional weights through the chosen display unit", async () => {
    const { displayMemberWeight, memberWeightFromInput } = await import("@/lib/member-intake");
    const pounds = 257.2;
    const kilograms = String(displayMemberWeight(pounds, "kg"));
    expect(Number(kilograms)).toBeCloseTo(116.7, 1);
    expect(memberWeightFromInput(kilograms, "kg")).toBeCloseTo(pounds, 0);
    expect(memberWeightFromInput("", "lb")).toBeUndefined();
    expect(memberWeightFromInput("257.2", "lb")).toBe(257.2);
  });
});
