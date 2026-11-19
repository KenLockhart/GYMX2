import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MemberIntakeWizard } from "@/components/member-intake-wizard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/(app)/intake/actions", () => ({
  completeMemberIntake: vi.fn(),
  saveMemberIntakeStep: vi.fn(),
}));

const coach = {
  coachId: "11111111-1111-4111-8111-111111111111",
  coachName: "Coach Two",
  bookingId: "22222222-2222-4222-8222-222222222222",
  sessionId: "55555555-5555-4555-8555-555555555555",
  startsAt: "2026-11-19T12:00:00.000Z",
  source: "session" as const,
  state: "review" as const,
};

describe("member intake wizard rendering", () => {
  it("keeps the forward action first for Enter while showing Back at the left", () => {
    const html = renderToStaticMarkup(createElement(MemberIntakeWizard, {
      initialAnswers: { age: 52 },
      step: 3,
      coach,
    }));
    const submitButtons = [...html.matchAll(/<button[^>]*type="submit"[^>]*value="([^"]+)"/g)]
      .map((match) => match[1]);

    expect(submitButtons).toEqual(["next", "back"]);
    expect(html).toMatch(/<button[^>]*value="back"[^>]*formNoValidate=""/);
    expect(html.indexOf("Coach Two")).toBeGreaterThanOrEqual(0);
    expect(html).toContain("Health and limits");
  });

  it("resumes on the requested step with saved fields prefilled", () => {
    const html = renderToStaticMarkup(createElement(MemberIntakeWizard, {
      initialAnswers: {
        age: 52,
        sex: "male",
        height_in: 73,
        current_weight_lbs: 257,
      },
      step: 1,
      coach,
    }));

    expect(html).toContain('value="52"');
    expect(html).toContain('value="257"');
    expect(html).toContain("Basic profile");
  });

  it("shows and initializes the same untouched stress value", () => {
    const html = renderToStaticMarkup(createElement(MemberIntakeWizard, {
      initialAnswers: {},
      step: 8,
      coach,
    }));

    expect(html).toMatch(/type="range"[^>]*value="5"/);
    expect(html).toContain('value="5"');
  });

  it("renders imperial height controls aligned with the canonical 36-to-96-inch bounds", () => {
    const html = renderToStaticMarkup(createElement(MemberIntakeWizard, {
      initialAnswers: { height_in: 73 },
      step: 1,
      coach,
    }));

    expect(html).toContain('min="3" max="8" required="" aria-label="ft" value="6"');
    expect(html).toContain('min="0" max="11" required="" aria-label="in" value="1"');
  });
});
