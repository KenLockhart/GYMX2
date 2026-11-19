import { describe, expect, it } from "vitest";
import {
  gatedSessionJoinUrl,
  isSafeExternalMeetingUrl,
  sessionJoinPath,
} from "@/lib/session-join";

const sessionId = "44444444-4444-4444-8444-444444444444";

describe("gated session join links", () => {
  it("creates only the internal session route for a valid provider URL", () => {
    expect(sessionJoinPath(sessionId)).toBe(`/calendar/${sessionId}/join`);
    expect(
      gatedSessionJoinUrl(
        "https://gymx2.example",
        sessionId,
        "https://meet.example/abc?token=synthetic",
      ),
    ).toBe(`https://gymx2.example/calendar/${sessionId}/join`);
  });

  it("rejects unsafe URLs, malformed sessions and sessions without a calendar row", () => {
    expect(isSafeExternalMeetingUrl("http://meet.example/abc")).toBe(false);
    expect(isSafeExternalMeetingUrl("https://user:pass@meet.example/abc")).toBe(false);
    expect(sessionJoinPath("not-a-uuid")).toBeNull();
    expect(gatedSessionJoinUrl("https://gymx2.example", null, "https://meet.example/abc")).toBeNull();
    expect(gatedSessionJoinUrl("javascript:alert(1)", sessionId, "https://meet.example/abc")).toBeNull();
  });
});
