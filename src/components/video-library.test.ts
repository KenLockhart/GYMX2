import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { es } from "@/i18n/es";
import {
  DAILY_CONTENT_VIDEO_DELETE_BLOCKED,
  DAILY_FUEL_VIDEO_DELETE_BLOCKED,
} from "@/lib/daily-content";

vi.mock("@/app/(app)/library/actions", () => ({
  deleteVideo: vi.fn(),
  setVideoVisibility: vi.fn(),
  updateVideoDetails: vi.fn(),
}));

import { videoLibraryDeleteErrorMessage } from "./video-library";

describe("video library delete feedback", () => {
  it("maps the exact Daily Content reservation sentinel to localized copy", () => {
    expect(videoLibraryDeleteErrorMessage(
      DAILY_CONTENT_VIDEO_DELETE_BLOCKED,
      en.library,
      "en",
    )).toBe(en.library.dailyContentReferenceError);
    expect(videoLibraryDeleteErrorMessage(
      DAILY_CONTENT_VIDEO_DELETE_BLOCKED,
      es.library,
      "es",
    )).toBe(es.library.dailyContentReferenceError);
  });

  it("keeps the current Daily Fuel assignment message distinct", () => {
    expect(videoLibraryDeleteErrorMessage(
      DAILY_FUEL_VIDEO_DELETE_BLOCKED,
      en.library,
      "en",
    )).toBe(en.library.dailyFuelReferenceError);
  });
});
