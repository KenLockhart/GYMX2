import { describe, expect, it } from "vitest";
import {
  privateLiveAcceptInputSchema,
  privateLiveGenerationSchema,
  privateLiveGrantInputSchema,
  privateLiveGrantRowSchema,
  privateLiveModeSchema,
  privateLiveOfferInputSchema,
  privateLiveProviderTag,
  isPrivateLiveWindowOpen,
  privateLiveWindowClosesAt,
  toPrivateLiveGrantSnapshot,
} from "./private-live";

const sessionId = "d38fce57-073a-4d5a-9cad-73e4d75a7f28";
const grantId = "7a86f017-8ad2-47a2-84c5-863fc9ba5cab";
const memberId = "40708d19-e673-40be-a7e2-7a6078df02a3";

describe("private live boundaries", () => {
  it("accepts only known live modes and UUID-bound action inputs", () => {
    expect(privateLiveModeSchema.parse("one_on_one")).toBe("one_on_one");
    expect(privateLiveModeSchema.safeParse("private").success).toBe(false);
    expect(
      privateLiveOfferInputSchema.safeParse({ sessionId, memberId }).success,
    ).toBe(true);
    expect(
      privateLiveOfferInputSchema.safeParse({
        sessionId,
        memberId: "not-a-user-id",
      }).success,
    ).toBe(false);
    expect(
      privateLiveGrantInputSchema.safeParse({ sessionId, grantId }).success,
    ).toBe(true);
  });

  it("requires an explicit camera-consent boolean when accepting", () => {
    expect(
      privateLiveAcceptInputSchema.safeParse({
        sessionId,
        grantId,
        allowMemberCamera: false,
      }).success,
    ).toBe(true);
    expect(
      privateLiveAcceptInputSchema.safeParse({ sessionId, grantId }).success,
    ).toBe(false);
    expect(
      privateLiveAcceptInputSchema.safeParse({
        sessionId,
        grantId,
        allowMemberCamera: "yes",
      }).success,
    ).toBe(false);
  });

  it("keeps generations bounded to safe positive integers", () => {
    expect(privateLiveGenerationSchema.parse(4)).toBe(4);
    expect(privateLiveGenerationSchema.parse("4")).toBe(4);
    expect(privateLiveGenerationSchema.safeParse(0).success).toBe(false);
    expect(
      privateLiveGenerationSchema.safeParse(Number.MAX_SAFE_INTEGER + 1)
        .success,
    ).toBe(false);
    expect(
      privateLiveGenerationSchema.safeParse("9007199254740992").success,
    ).toBe(false);
  });

  it("uses the shared 30-minute early and 60-minute late live window", () => {
    const startsAt = "2026-11-15T14:00:00.000Z";
    const endsAt = "2026-11-15T15:00:00.000Z";
    expect(
      isPrivateLiveWindowOpen(
        startsAt,
        endsAt,
        new Date("2026-11-15T13:29:59.999Z"),
      ),
    ).toBe(false);
    expect(
      isPrivateLiveWindowOpen(
        startsAt,
        endsAt,
        new Date("2026-11-15T13:30:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isPrivateLiveWindowOpen(
        startsAt,
        endsAt,
        new Date("2026-11-15T16:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isPrivateLiveWindowOpen(
        startsAt,
        endsAt,
        new Date("2026-11-15T16:00:00.001Z"),
      ),
    ).toBe(false);
    expect(privateLiveWindowClosesAt(endsAt)).toBe(
      Date.parse("2026-11-15T16:00:00.000Z"),
    );
    expect(privateLiveWindowClosesAt("invalid")).toBeNull();
  });

  it("builds deterministic provider tags without accepting user-provided tags", () => {
    expect(privateLiveProviderTag(sessionId, 12, "member")).toBe(
      `gymx2-private:${sessionId}:12:member`,
    );
    expect(privateLiveProviderTag(sessionId.toUpperCase(), 12, "coach")).toBe(
      `gymx2-private:${sessionId}:12:coach`,
    );
  });

  it("returns only the participant-safe grant snapshot fields", () => {
    const parsed = privateLiveGrantRowSchema.parse({
      grant_id: grantId,
      session_id: sessionId,
      generation: "2",
      state: "accepted",
      expires_at: "2026-11-15T12:30:00.000Z",
      member_camera_allowed: false,
      coach_live_at: "2026-11-15T12:00:00.000Z",
      member_live_at: null,
      input_uid: "provider-input-secret",
      playback_id: "provider-playback-secret",
      provider_tag: "provider-tag-secret",
    });
    const snapshot = toPrivateLiveGrantSnapshot(parsed);

    expect(snapshot).toEqual({
      grantId,
      generation: 2,
      state: "accepted",
      expiresAt: "2026-11-15T12:30:00.000Z",
      memberCameraAllowed: false,
      coachLive: true,
      memberLive: false,
    });
    expect(snapshot).not.toHaveProperty("input_uid");
    expect(snapshot).not.toHaveProperty("playback_id");
    expect(snapshot).not.toHaveProperty("provider_tag");
  });
});
