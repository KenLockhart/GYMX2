import { describe, expect, it } from "vitest";
import {
  canPreviewProgramIntro,
  canUseProgramDayVideo,
  canUseProgramIntroVideo,
  canWatchProgramDay,
  nextDay,
  progressPercent,
  unlockedThrough,
  weeksLabel,
} from "./programs";

describe("unlockedThrough", () => {
  it("opens day 1 on the start day and one more each day", () => {
    expect(unlockedThrough("2026-11-08", "2026-11-08")).toBe(1);
    expect(unlockedThrough("2026-11-08", "2026-11-14")).toBe(7);
  });

  it("opens nothing before the start", () => {
    expect(unlockedThrough("2026-11-10", "2026-11-08")).toBe(0);
  });
});

describe("labels", () => {
  it.each([
    [0, "No days yet"],
    [1, "1 day"],
    [5, "5 days"],
    [7, "1 week · 7 days"],
    [42, "6 weeks · 42 days"],
  ])("%i days", (count, label) => {
    expect(weeksLabel(count)).toBe(label);
  });

  it("works out progress", () => {
    expect(progressPercent(3, 42)).toBe(7);
    expect(progressPercent(0, 0)).toBe(0);
  });
});

describe("nextDay", () => {
  const days = [
    { id: "a", day_number: 1 },
    { id: "b", day_number: 2 },
    { id: "c", day_number: 3 },
  ];

  it("finds the first unlocked day not yet done", () => {
    expect(nextDay(days, new Set(["a"]), 3)?.id).toBe("b");
  });

  it("is null when caught up", () => {
    expect(nextDay(days, new Set(["a", "b"]), 2)).toBeNull();
  });
});

describe("program intro video access", () => {
  const readyOwnedVideo = {
    id: "video-1",
    creatorId: "creator-1",
    status: "ready",
  };

  it("accepts only a ready video owned by the program creator", () => {
    expect(canUseProgramIntroVideo(readyOwnedVideo, "creator-1")).toBe(true);
    expect(
      canUseProgramIntroVideo(
        { ...readyOwnedVideo, creatorId: "creator-2" },
        "creator-1",
      ),
    ).toBe(false);
    expect(
      canUseProgramIntroVideo(
        { ...readyOwnedVideo, status: "processing" },
        "creator-1",
      ),
    ).toBe(false);
    expect(canUseProgramIntroVideo(null, "creator-1")).toBe(false);
  });

  it("lets the creator preview a draft intro but hides drafts from other viewers", () => {
    expect(
      canPreviewProgramIntro({
        isOwner: true,
        isPublished: false,
        programIsVisible: true,
        video: readyOwnedVideo,
        creatorId: "creator-1",
      }),
    ).toBe(true);
    expect(
      canPreviewProgramIntro({
        isOwner: false,
        isPublished: false,
        programIsVisible: true,
        video: readyOwnedVideo,
        creatorId: "creator-1",
      }),
    ).toBe(false);
  });

  it("previews a selected intro only for published, visible programs", () => {
    expect(
      canPreviewProgramIntro({
        isOwner: false,
        isPublished: true,
        programIsVisible: true,
        video: readyOwnedVideo,
        creatorId: "creator-1",
      }),
    ).toBe(true);
    expect(
      canPreviewProgramIntro({
        isOwner: false,
        isPublished: true,
        programIsVisible: false,
        video: readyOwnedVideo,
        creatorId: "creator-1",
      }),
    ).toBe(false);
    expect(
      canPreviewProgramIntro({
        isOwner: false,
        isPublished: true,
        programIsVisible: true,
        video: { ...readyOwnedVideo, creatorId: "another-creator" },
        creatorId: "creator-1",
      }),
    ).toBe(false);
  });
});

describe("program day playback access", () => {
  const program = {
    id: "program-1",
    creatorId: "creator-1",
    published: true,
  };
  const day = {
    programId: "program-1",
    dayNumber: 1,
    videoId: "video-1",
  };
  const enrollment = {
    id: "enrollment-1",
    programId: "program-1",
    memberId: "member-1",
    startedOn: "2026-11-18",
  };

  it("lets the creator and admins preview scoped days without enrollment", () => {
    expect(
      canWatchProgramDay({
        viewerId: "creator-1",
        viewerRole: "coach",
        program: { ...program, published: false },
        day,
        today: "2026-11-18",
      }),
    ).toBe(true);
    expect(
      canWatchProgramDay({
        viewerId: "admin-1",
        viewerRole: "admin",
        program: { ...program, published: false },
        day,
        today: "2026-11-18",
      }),
    ).toBe(true);
  });

  it("requires a published program, the viewer's enrollment, and an unlocked day", () => {
    expect(
      canWatchProgramDay({
        viewerId: "member-1",
        viewerRole: "member",
        program,
        day,
        enrollment,
        today: "2026-11-18",
      }),
    ).toBe(true);
    expect(
      canWatchProgramDay({
        viewerId: "member-1",
        viewerRole: "member",
        program,
        day: { ...day, dayNumber: 2 },
        enrollment,
        today: "2026-11-18",
      }),
    ).toBe(false);
    expect(
      canWatchProgramDay({
        viewerId: "member-1",
        viewerRole: "member",
        program: { ...program, published: false },
        day,
        enrollment,
        today: "2026-11-18",
      }),
    ).toBe(false);
    expect(
      canWatchProgramDay({
        viewerId: "member-2",
        viewerRole: "member",
        program,
        day,
        enrollment,
        today: "2026-11-18",
      }),
    ).toBe(false);
  });

  it("rejects foreign days, video-less days, and unrelated roles", () => {
    expect(
      canWatchProgramDay({
        viewerId: "member-1",
        viewerRole: "member",
        program,
        day: { ...day, programId: "program-2" },
        enrollment,
        today: "2026-11-18",
      }),
    ).toBe(false);
    expect(
      canWatchProgramDay({
        viewerId: "creator-1",
        viewerRole: "coach",
        program,
        day: { ...day, videoId: null },
        today: "2026-11-18",
      }),
    ).toBe(false);
    expect(
      canWatchProgramDay({
        viewerId: "moderator-1",
        viewerRole: "moderator",
        program,
        day,
        today: "2026-11-18",
      }),
    ).toBe(false);
  });

  it("accepts only the exact ready video owned by the program creator", () => {
    const video = { id: "video-1", creatorId: "creator-1", status: "ready" };
    expect(
      canUseProgramDayVideo(video, {
        dayVideoId: "video-1",
        creatorId: "creator-1",
      }),
    ).toBe(true);
    expect(
      canUseProgramDayVideo(video, {
        dayVideoId: "video-2",
        creatorId: "creator-1",
      }),
    ).toBe(false);
    expect(
      canUseProgramDayVideo(
        { ...video, creatorId: "another-creator" },
        { dayVideoId: "video-1", creatorId: "creator-1" },
      ),
    ).toBe(false);
    expect(
      canUseProgramDayVideo(
        { ...video, status: "processing" },
        { dayVideoId: "video-1", creatorId: "creator-1" },
      ),
    ).toBe(false);
  });
});
