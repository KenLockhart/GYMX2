import { describe, expect, it } from "vitest";
import {
  dueMemberIntakeReminderPhase,
  memberIntakeReminderEmail,
} from "@/lib/member-intake-reminder-email";

describe("member intake reminders", () => {
  const now = new Date("2026-11-18T12:00:00.000Z");

  it("detects bounded 24-hour and 2-hour reminder windows", () => {
    expect(dueMemberIntakeReminderPhase(new Date(now.getTime() + 24 * 60 * 60_000), now)).toBe("24h");
    expect(dueMemberIntakeReminderPhase(new Date(now.getTime() + 2 * 60 * 60_000), now)).toBe("2h");
    expect(dueMemberIntakeReminderPhase(new Date(now.getTime() + 12 * 60 * 60_000), now)).toBeNull();
    expect(dueMemberIntakeReminderPhase(new Date(now.getTime() - 60_000), now)).toBeNull();
  });

  it("sends only booking metadata and a link, never intake answer fields", () => {
    const email = memberIntakeReminderEmail({
      siteUrl: "https://gymx2.example",
      memberName: "Member",
      coachName: "Coach",
      coachId: "coach-uuid",
      sessionId: "44444444-4444-4444-8444-444444444444",
      startsAt: "2026-11-19T12:00:00.000Z",
      phase: "24h",
      locale: "en",
    });
    const content = `${email.subject}\n${email.html}\n${email.text}`;
    expect(content).toContain("Review intake");
    expect(content).toContain("coach=coach-uuid");
    expect(content).toContain("returnTo=%2Fcalendar%2F44444444-4444-4444-8444-444444444444%2Fjoin");
    for (const privateAnswer of ["medical_notes", "injuries", "exercise_clearance", "food_allergies"]) {
      expect(content).not.toContain(privateAnswer);
    }
  });
});
