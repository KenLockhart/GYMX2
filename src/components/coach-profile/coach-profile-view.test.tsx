import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SAMPLE_COACH } from "../../lib/coach-sample";
import { CoachProfile } from "./coach-profile-view";

vi.mock("./profile-client", () => ({
  LocalDateTime: () => null,
  SaveCoachButton: () => null,
}));

function renderCoachProfile(photoUrl: string | null) {
  return renderToStaticMarkup(
    createElement(CoachProfile, {
      profile: {
        ...SAMPLE_COACH,
        id: "coach-fixture",
        sample: false,
        name: "Coach Regression",
        firstName: "Regression",
        photoUrl,
        match: null,
        intro: null,
      },
    }),
  );
}

describe("CoachProfile server rendering", () => {
  it("renders a real coach photo with alt text from the profile", () => {
    const html = renderCoachProfile("/coach-photos/fixture.webp");

    expect(html).toContain('src="/coach-photos/fixture.webp"');
    expect(html).toContain('alt="Portrait of Coach Regression"');
  });

  it("renders the portrait placeholder when no photo is available", () => {
    const html = renderCoachProfile(null);

    expect(html).toContain(
      'aria-label="Coach Regression: portrait coming soon"',
    );
    expect(html).not.toContain("<img");
  });
});
