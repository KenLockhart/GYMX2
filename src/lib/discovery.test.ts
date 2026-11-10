import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  type CoachCard,
  filterCoaches,
  NO_FILTERS,
  sortCoaches,
} from "./discovery";

function card(id: string, change: Partial<CoachCard> = {}): CoachCard {
  return {
    id,
    name: id,
    photoUrl: null,
    headline: "",
    specialties: [],
    location: "Atlanta, GA",
    formats: ["online"],
    rating: null,
    experienceYears: 5,
    startingPriceCents: 10000,
    match: null,
    verified: false,
    acceptingClients: true,
    hasProfile: true,
    populations: [],
    languages: "English",
    motivation: null,
    accountability: null,
    accessibility: false,
    joined: false,
    saved: false,
    passed: false,
    ...change,
  };
}

describe("discovery filters", () => {
  const cards = [
    card("Ana", {
      specialties: ["Strength"],
      populations: ["Complete beginners"],
      verified: true,
      rating: { average: 4.8, count: 10 },
    }),
    card("Ben", {
      formats: ["in_person"],
      location: "Orlando, FL",
      startingPriceCents: 25000,
      languages: "English, Spanish",
    }),
    card("Cy", {
      hasProfile: false,
      startingPriceCents: null,
      experienceYears: null,
    }),
  ];

  it("returns everyone with no filters", () => {
    expect(filterCoaches(cards, NO_FILTERS)).toHaveLength(3);
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
  });

  it("filters by each field", () => {
    const names = (f: Partial<typeof NO_FILTERS>) =>
      filterCoaches(cards, { ...NO_FILTERS, ...f }).map((c) => c.id);
    expect(names({ search: "strength" })).toEqual(["Ana"]);
    expect(names({ populations: ["Complete beginners"] })).toEqual(["Ana"]);
    expect(names({ maxPrice: 15000 })).toEqual(["Ana"]);
    expect(names({ format: "in_person" })).toEqual(["Ben"]);
    expect(names({ location: "orlando" })).toEqual(["Ben"]);
    expect(names({ language: "spanish" })).toEqual(["Ben"]);
    expect(names({ verifiedOnly: true })).toEqual(["Ana"]);
    expect(names({ minRating: 4.5 })).toEqual(["Ana"]);
    expect(names({ minYears: 3 })).toEqual(["Ana", "Ben"]);
    expect(names({ acceptingOnly: true })).toEqual(["Ana", "Ben"]);
  });
});

describe("discovery sorting", () => {
  it("puts eligible scored matches first and waitlisted coaches last", () => {
    const sorted = sortCoaches(
      [
        card("Low", { match: { total: 40, eligible: true } }),
        card("High", { match: { total: 90, eligible: true } }),
        card("Blocked", { match: { total: null, eligible: false } }),
        card("Waitlist", {
          acceptingClients: false,
          match: { total: 99, eligible: true },
        }),
        card("Basic", { hasProfile: false }),
      ],
      "match",
    ).map((c) => c.id);
    expect(sorted.slice(0, 2)).toEqual(["High", "Low"]);
    expect(sorted[sorted.length - 1]).toBe("Waitlist");
    expect(sorted.indexOf("Blocked")).toBeGreaterThan(sorted.indexOf("Low"));
  });

  it("sorts by price, cheapest first, with unknown prices last", () => {
    const sorted = sortCoaches(
      [
        card("A", { startingPriceCents: 20000 }),
        card("B", { startingPriceCents: null }),
        card("C", { startingPriceCents: 5000 }),
      ],
      "price",
    ).map((c) => c.id);
    expect(sorted).toEqual(["C", "A", "B"]);
  });
});
