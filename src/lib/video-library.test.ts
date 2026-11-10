import { describe, expect, it } from "vitest";
import {
  type LibraryCard,
  libraryRows,
  readCategory,
  searchVideos,
} from "./video-library";

function video(
  id: string,
  category: LibraryCard["category"],
  createdAt: string,
  extra: Partial<LibraryCard> = {},
): LibraryCard {
  return {
    id,
    title: `Video ${id}`,
    description: "",
    category,
    visibility: "members",
    status: "ready",
    durationSeconds: 20,
    createdAt,
    coachId: "c",
    coachName: "Coach Jasmine",
    ...extra,
  };
}

describe("libraryRows", () => {
  it("groups by category in a fixed order, newest first", () => {
    const rows = libraryRows([
      video("a", "Lower Body", "2026-01-01"),
      video("b", "Upper Body", "2026-01-02"),
      video("c", "Lower Body", "2026-01-03"),
    ]);
    expect(rows.map((r) => r.title)).toEqual(["Upper Body", "Lower Body"]);
    expect(rows[1].videos.map((v) => v.id)).toEqual(["c", "a"]);
  });

  it("adds a Recently added row once there are more than six videos", () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      video(String(i), "Core", `2026-01-0${i + 1}`),
    );
    const rows = libraryRows(many);
    expect(rows[0].title).toBe("Recently added");
    expect(rows[0].videos[0].id).toBe("6");
  });

  it("calls the Other row More videos only when other rows exist", () => {
    expect(libraryRows([video("a", "Other", "2026-01-01")])[0].title).toBe(
      "Videos",
    );
    expect(
      libraryRows([
        video("a", "Other", "2026-01-01"),
        video("b", "Core", "2026-01-01"),
      ]).map((r) => r.title),
    ).toEqual(["Core", "More videos"]);
  });
});

describe("searchVideos", () => {
  it("matches every word across title, category and coach", () => {
    const list = [
      video("a", "Lower Body", "x", { title: "Leg Press" }),
      video("b", "Upper Body", "x", { title: "Curl" }),
    ];
    expect(searchVideos(list, "leg lower").map((v) => v.id)).toEqual(["a"]);
    expect(searchVideos(list, "jasmine").length).toBe(2);
    expect(searchVideos(list, "  ").length).toBe(2);
  });
});

describe("readCategory", () => {
  it("falls back to Other for anything unknown", () => {
    expect(readCategory("Core")).toBe("Core");
    expect(readCategory("Legs")).toBe("Other");
  });
});
