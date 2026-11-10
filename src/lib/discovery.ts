// Coach discovery: the card each coach shows as, and the filters and sorting. Shared by the server
// and the browser so filtering is instant and testable.

export type CoachCard = {
  id: string;
  name: string;
  photoUrl: string | null;
  headline: string;
  specialties: string[];
  location: string;
  formats: ("online" | "in_person")[];
  rating: { average: number; count: number } | null;
  experienceYears: number | null;
  startingPriceCents: number | null;
  match: { total: number | null; eligible: boolean } | null;
  verified: boolean;
  acceptingClients: boolean;
  // Only coaches with an approved profile have the details below; others show a basic card.
  hasProfile: boolean;
  populations: string[];
  languages: string;
  motivation: string | null;
  accountability: string | null;
  accessibility: boolean;
  joined: boolean;
  saved: boolean;
  passed: boolean;
};

export type DiscoveryFilters = {
  search: string;
  populations: string[];
  maxPrice: number | null;
  minYears: number | null;
  minRating: number | null;
  location: string;
  format: "any" | "online" | "in_person";
  acceptingOnly: boolean;
  language: "any" | "spanish";
  motivation: string | null;
  accountability: string | null;
  accessibility: boolean;
  verifiedOnly: boolean;
};

export const NO_FILTERS: DiscoveryFilters = {
  search: "",
  populations: [],
  maxPrice: null,
  minYears: null,
  minRating: null,
  location: "",
  format: "any",
  acceptingOnly: false,
  language: "any",
  motivation: null,
  accountability: null,
  accessibility: false,
  verifiedOnly: false,
};

export type DiscoverySort =
  "match" | "rating" | "price" | "experience" | "name";

export function activeFilterCount(f: DiscoveryFilters) {
  return [
    f.search.trim() !== "",
    f.populations.length > 0,
    f.maxPrice !== null,
    f.minYears !== null,
    f.minRating !== null,
    f.location.trim() !== "",
    f.format !== "any",
    f.acceptingOnly,
    f.language !== "any",
    f.motivation !== null,
    f.accountability !== null,
    f.accessibility,
    f.verifiedOnly,
  ].filter(Boolean).length;
}

const contains = (haystack: string, needle: string) =>
  haystack.toLowerCase().includes(needle.trim().toLowerCase());

// A filter that needs profile details leaves out coaches who don't have them yet.
export function filterCoaches(cards: CoachCard[], f: DiscoveryFilters) {
  return cards.filter((c) => {
    if (f.search.trim()) {
      const text = [
        c.name,
        c.headline,
        c.specialties.join(" "),
        c.location,
      ].join(" ");
      if (!contains(text, f.search)) return false;
    }
    if (
      f.populations.length &&
      !f.populations.some((p) => c.populations.includes(p))
    )
      return false;
    if (
      f.maxPrice !== null &&
      (c.startingPriceCents === null || c.startingPriceCents > f.maxPrice)
    )
      return false;
    if (
      f.minYears !== null &&
      (c.experienceYears === null || c.experienceYears < f.minYears)
    )
      return false;
    if (f.minRating !== null && (!c.rating || c.rating.average < f.minRating))
      return false;
    if (f.location.trim() && !contains(c.location, f.location)) return false;
    if (f.format !== "any" && !c.formats.includes(f.format)) return false;
    if (f.acceptingOnly && (!c.hasProfile || !c.acceptingClients)) return false;
    if (
      f.language === "spanish" &&
      !/spanish|español|espanol/i.test(c.languages)
    )
      return false;
    if (f.motivation && c.motivation !== f.motivation) return false;
    if (f.accountability && c.accountability !== f.accountability) return false;
    if (f.accessibility && !c.accessibility) return false;
    if (f.verifiedOnly && !c.verified) return false;
    return true;
  });
}

// Relevant, available coaches first. Paid placement never changes this order.
export function sortCoaches(cards: CoachCard[], sort: DiscoverySort) {
  const score = (c: CoachCard) => {
    switch (sort) {
      case "match":
        // Eligible scored matches, then coaches with a profile, then everyone else.
        return c.match?.eligible && c.match.total !== null
          ? 1000 + c.match.total
          : c.hasProfile && c.match?.eligible !== false
            ? 500 + (c.rating?.average ?? 0)
            : 0;
      case "rating":
        return c.rating ? c.rating.average * 1000 + c.rating.count : -1;
      case "price":
        return c.startingPriceCents === null
          ? -Infinity
          : -c.startingPriceCents;
      case "experience":
        return c.experienceYears ?? -1;
      case "name":
        return 0;
    }
  };
  return [...cards].sort(
    (a, b) =>
      Number(b.acceptingClients || !b.hasProfile) -
        Number(a.acceptingClients || !a.hasProfile) ||
      score(b) - score(a) ||
      a.name.localeCompare(b.name),
  );
}
