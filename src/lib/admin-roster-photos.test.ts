import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_ROSTER_COACH_PHOTO_BUCKET,
  ADMIN_ROSTER_PROFILE_PHOTO_BUCKET,
  resolveAdminRosterPhotoUrls,
  type AdminRosterPhotoBucket,
  type AdminRosterPhotoSources,
  type AdminRosterSignedPhoto,
} from "./admin-roster-photos";

function sources(
  overrides: Partial<Omit<AdminRosterPhotoSources, "signBatch">> = {},
  signBatch: AdminRosterPhotoSources["signBatch"] = async (_bucket, paths) =>
    paths.map((path) => ({ path, signedUrl: `signed:${path}` })),
): AdminRosterPhotoSources {
  return {
    userIds: ["account", "draft", "published", "empty"],
    accountPhotos: [],
    coachDrafts: [],
    publishedCoaches: [],
    signBatch,
    ...overrides,
  };
}

describe("admin roster photo resolution", () => {
  it("prefers a successfully signed account photo over coach photos", async () => {
    const result = await resolveAdminRosterPhotoUrls(
      sources({
        accountPhotos: [{ user_id: "account", photo_path: "account/photo.jpg" }],
        coachDrafts: [{ coach_id: "account", photo_path: "draft.jpg" }],
        publishedCoaches: [{ coach_id: "account", photo_path: "public.jpg" }],
      }),
    );

    expect(result.get("account")).toBe("signed:account/photo.jpg");
  });

  it("prefers a draft portrait before the published copy", async () => {
    const result = await resolveAdminRosterPhotoUrls(
      sources({
        coachDrafts: [{ coach_id: "draft", photo_path: "draft.jpg" }],
        publishedCoaches: [{ coach_id: "draft", photo_path: "public.jpg" }],
      }),
    );

    expect(result.get("draft")).toBe("signed:draft.jpg");
  });

  it("uses a published portrait when no draft photo is available", async () => {
    const result = await resolveAdminRosterPhotoUrls(
      sources({
        coachDrafts: [{ coach_id: "published", photo_path: null }],
        publishedCoaches: [{ coach_id: "published", photo_path: "public.jpg" }],
      }),
    );

    expect(result.get("published")).toBe("signed:public.jpg");
  });

  it("leaves people with no photo out of the URL map for the initials fallback", async () => {
    const result = await resolveAdminRosterPhotoUrls(sources());

    expect(result.has("empty")).toBe(false);
    expect(result.size).toBe(0);
  });

  it("falls back when the higher-priority bucket signing fails", async () => {
    const signBatch = vi.fn(
      async (
        bucket: AdminRosterPhotoBucket,
        paths: readonly string[],
      ): Promise<readonly AdminRosterSignedPhoto[]> => {
        if (bucket === ADMIN_ROSTER_PROFILE_PHOTO_BUCKET)
          throw new Error("profile bucket unavailable");
        return paths.map((path) => ({ path, signedUrl: `signed:${path}` }));
      },
    );
    const result = await resolveAdminRosterPhotoUrls(
      sources(
        {
          accountPhotos: [{ user_id: "account", photo_path: "account.jpg" }],
          coachDrafts: [{ coach_id: "account", photo_path: "draft.jpg" }],
        },
        signBatch,
      ),
    );

    expect(result.get("account")).toBe("signed:draft.jpg");
    expect(signBatch).toHaveBeenCalledTimes(2);
  });

  it("scopes rows to the requested IDs and deduplicates each bucket batch", async () => {
    const signBatch = vi.fn(
      async (
        _bucket: AdminRosterPhotoBucket,
        paths: readonly string[],
      ): Promise<readonly AdminRosterSignedPhoto[]> =>
        paths.map((path) => ({ path, signedUrl: `signed:${path}` })),
    );
    const result = await resolveAdminRosterPhotoUrls(
      sources(
        {
          userIds: ["account", "draft"],
          accountPhotos: [
            { user_id: "account", photo_path: "same-account.jpg" },
            { user_id: "outside", photo_path: "outside.jpg" },
          ],
          coachDrafts: [
            { coach_id: "draft", photo_path: "same-coach.jpg" },
            { coach_id: "account", photo_path: "same-coach.jpg" },
            { coach_id: "outside", photo_path: "outside-coach.jpg" },
          ],
        },
        signBatch,
      ),
    );

    expect(result.size).toBe(2);
    expect(result.has("outside")).toBe(false);
    expect(signBatch).toHaveBeenCalledTimes(2);
    expect(signBatch).toHaveBeenCalledWith(
      ADMIN_ROSTER_PROFILE_PHOTO_BUCKET,
      ["same-account.jpg"],
    );
    expect(signBatch).toHaveBeenCalledWith(
      ADMIN_ROSTER_COACH_PHOTO_BUCKET,
      ["same-coach.jpg"],
    );
  });

  it("uses the next signed candidate when one path in a bucket is unusable", async () => {
    const result = await resolveAdminRosterPhotoUrls(
      sources(
        {
          coachDrafts: [{ coach_id: "draft", photo_path: "bad-draft.jpg" }],
          publishedCoaches: [{ coach_id: "draft", photo_path: "public.jpg" }],
        },
        async (_bucket, paths) =>
          paths.map((path) => ({
            path,
            signedUrl: path === "bad-draft.jpg" ? null : `signed:${path}`,
          })),
      ),
    );

    expect(result.get("draft")).toBe("signed:public.jpg");
  });
});
