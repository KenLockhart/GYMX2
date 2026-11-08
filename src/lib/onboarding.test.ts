import { describe, expect, it } from "vitest";
import { matchCoaches } from "./onboarding";

describe("coach matching", () => {
  const coaches = [
    { id: "strength", specialties: ["build_muscle", "get_fit"], programs: 1 },
    { id: "calm", specialties: ["reduce_stress", "sleep_better"], programs: 0 },
    { id: "none", specialties: [], programs: 2 },
  ];

  it("ranks shared goals first, then the member's pillar", () => {
    const matches = matchCoaches(
      { goals: ["build_muscle", "sleep_better"], focus: "mind" },
      coaches,
    );
    expect(matches.map((match) => match.id)).toEqual(["calm", "strength"]);
    expect(matches[0].shared).toEqual(["sleep_better"]);
  });

  it("leaves out coaches with nothing in common", () => {
    expect(
      matchCoaches({ goals: ["grow_spiritually"], focus: "spirit" }, coaches),
    ).toEqual([]);
  });
});
