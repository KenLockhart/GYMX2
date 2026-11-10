import { describe, expect, it } from "vitest";
import {
  coachDraftSchema,
  emptyDraft,
  profileCompletion,
  profileWarnings,
  readDraft,
  toCoachView,
} from "./coach-draft";
import { startingMonthlyPrice } from "./coach-profile";

function complete() {
  const d = emptyDraft();
  d.headline = "I help beginners get strong.";
  d.location = "Atlanta, GA";
  d.formats = ["online"];
  d.specialties = ["Strength"];
  d.about.intro = "x".repeat(100);
  d.populations = [{ label: "Complete beginners", note: "" }];
  d.style.motivation.primary = "encouraging";
  d.style.structure.primary = "moderate";
  d.style.communication.primary = "friendly";
  d.style.accountability.primary = "weekly";
  d.style.relationship.primary = "mentor";
  d.loveLanguages.primary = "encouragement";
  d.coaching.included = ["Weekly check-ins"];
  d.experienceYears = 5;
  d.packages = [
    {
      name: "Online",
      kind: "monthly",
      priceCents: 9900,
      sessions: "",
      duration: "",
      includes: [],
      featured: false,
    },
  ];
  d.policies = { cancellation: "Anytime" };
  return d;
}

describe("coach draft", () => {
  it("starts empty and seeds About me from the old bio", () => {
    const d = emptyDraft({ bio: "Hi, I'm a coach." });
    expect(d.about.intro).toBe("Hi, I'm a coach.");
    expect(d.packages).toEqual([]);
    expect(d.availability.timeZone).toBe("America/New_York");
  });

  it("keeps valid parts of a damaged draft", () => {
    const d = readDraft({
      headline: "Strong",
      formats: ["teleport"],
      packages: "nope",
    });
    expect(d.headline).toBe("Strong");
    expect(d.formats).toEqual([]);
    expect(d.packages).toEqual([]);
  });

  it("rejects values outside the option lists and limits", () => {
    expect(
      coachDraftSchema.safeParse({ specialties: ["a", "b", "c", "d"] }).success,
    ).toBe(false);
    expect(
      coachDraftSchema.safeParse({ style: { motivation: { primary: "mean" } } })
        .success,
    ).toBe(false);
    expect(
      coachDraftSchema.safeParse({
        populations: [{ label: "Wizards", note: "" }],
      }).success,
    ).toBe(false);
    expect(coachDraftSchema.safeParse({ experienceYears: 99 }).success).toBe(
      false,
    );
  });

  it("knows what's missing before submitting", () => {
    expect(profileCompletion(emptyDraft(), false).ready).toBe(false);
    const done = profileCompletion(complete(), false);
    expect(done.ready).toBe(true);
    expect(done.percent).toBeLessThan(100);
    expect(profileCompletion(complete(), true).percent).toBeGreaterThan(
      done.percent,
    );
  });

  it("flags guarantees, medical claims and outside payments", () => {
    const d = complete();
    expect(profileWarnings(d)).toEqual([]);
    d.headline = "Guaranteed results in 30 days";
    d.about.intro = "Venmo me to skip the fees. I can cure back pain.";
    const warnings = profileWarnings(d);
    expect(warnings.some((w) => w.includes("guarantees"))).toBe(true);
    expect(warnings.some((w) => w.includes("payment"))).toBe(true);
    expect(warnings.some((w) => w.includes("medical"))).toBe(true);
  });

  it("flags rankings, timed results and unchecked certifications", () => {
    const d = complete();
    d.headline = "Atlanta's #1 trainer: lose 20 lbs in 30 days";
    const warnings = profileWarnings(d);
    expect(warnings.some((w) => w.includes("rankings"))).toBe(true);
    expect(warnings.some((w) => w.includes("set time"))).toBe(true);

    d.headline = "NASM certified strength coach";
    expect(
      profileWarnings(d, []).some((w) => w.includes("Qualifications")),
    ).toBe(true);
    expect(
      profileWarnings(d, [{ status: "rejected" }]).some((w) =>
        w.includes("Qualifications"),
      ),
    ).toBe(true);
    expect(
      profileWarnings(d, [{ status: "pending" }]).some((w) =>
        w.includes("Qualifications"),
      ),
    ).toBe(false);
    // Without credentials to check against, no certification warning.
    expect(profileWarnings(d).some((w) => w.includes("Qualifications"))).toBe(
      false,
    );
  });

  it("turns a draft into the member view", () => {
    const d = complete();
    d.about.intro = "First paragraph.\n\nSecond paragraph.";
    d.packages.push({
      name: "Intro",
      kind: "intro",
      priceCents: 0,
      sessions: "",
      duration: "",
      includes: [],
      featured: false,
    });
    const view = toCoachView(d, {
      id: "c1",
      name: "Coach Sam Lee",
      photoUrl: null,
      rating: null,
      reviews: [],
    });
    expect(view.sample).toBe(false);
    expect(view.firstName).toBe("Sam");
    expect(view.about.intro).toEqual(["First paragraph.", "Second paragraph."]);
    expect(view.verification).toBe("unverified");
    expect(view.match).toBeNull();
    expect(view.intro).toBeNull();
    expect(startingMonthlyPrice(view.packages)).toBe(9900);
    expect(view.style.attributes[0]).toEqual({
      label: "Motivational approach",
      primary: "Encouraging and patient",
    });
    expect(view.policies).toEqual([
      { label: "Cancellation", value: "Anytime" },
    ]);
  });
});
