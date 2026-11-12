import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  cancelProfilePhotoUpload,
  finalizeProfilePhotoUpload,
  isValidProfilePhoto,
  removeProfilePhoto,
  type ProfilePhotoDependencies,
  type ProfilePhotoUpload,
} from "./profile-photo";
import {
  isOwnedProfilePhotoPath,
  makeProfilePhotoPath,
  PROFILE_PHOTO_MAX_BYTES,
  validateProfilePhotoDescriptor,
} from "./profile-photo-shared";

const owner = "00000000-0000-0000-0000-000000000001";
const otherOwner = "00000000-0000-0000-0000-000000000002";
const path = `${owner}/10000000-0000-0000-0000-000000000001.jpg`;
const priorPath = `${owner}/10000000-0000-0000-0000-000000000002.png`;

async function imageBytes(format: "jpeg" | "png" | "webp") {
  return sharp({
    create: {
      width: 4,
      height: 3,
      channels: 3,
      background: { r: 84, g: 120, b: 34 },
    },
  })
    .toFormat(format)
    .toBuffer();
}

function dependencies(
  overrides: Partial<ProfilePhotoDependencies> = {},
  initialState: "pending" | "active" | "retired" = "pending",
): ProfilePhotoDependencies & { removed: string[] } {
  const removed: string[] = [];
  const record: ProfilePhotoUpload = {
    ownerId: owner,
    state: initialState,
    contentType: "image/jpeg",
    expectedSize: 20,
  };
  return {
    removed,
    getUpload: async () => record,
    getCurrentPath: async () => null,
    readObject: async () => null,
    commit: async () => null,
    retire: async () => {
      record.state = "retired";
      return true;
    },
    removeObject: async (value) => {
      removed.push(value);
    },
    signedUrl: async () => "signed-photo-url",
    ...overrides,
  };
}

describe("profile photo descriptor and path checks", () => {
  it("accepts supported image types and an exact size within the limit", () => {
    expect(
      validateProfilePhotoDescriptor({ contentType: "image/webp", size: 20 }),
    ).toEqual({ contentType: "image/webp", size: 20 });
    expect(
      validateProfilePhotoDescriptor({
        contentType: "image/jpeg",
        size: PROFILE_PHOTO_MAX_BYTES,
      }),
    ).toMatchObject({ contentType: "image/jpeg" });
  });

  it("rejects inherited MIME names, unsupported types, zero and oversized files", () => {
    expect(
      validateProfilePhotoDescriptor({ contentType: "toString", size: 10 }),
    ).toEqual({ error: "invalid-type" });
    expect(
      validateProfilePhotoDescriptor({ contentType: "image/svg+xml", size: 10 }),
    ).toEqual({ error: "invalid-type" });
    expect(
      validateProfilePhotoDescriptor({ contentType: "image/png", size: 0 }),
    ).toEqual({ error: "too-large" });
    expect(
      validateProfilePhotoDescriptor({
        contentType: "image/png",
        size: PROFILE_PHOTO_MAX_BYTES + 1,
      }),
    ).toEqual({ error: "too-large" });
  });

  it("creates a constrained owner path and rejects a path owned by another account", () => {
    expect(
      makeProfilePhotoPath(owner, "10000000-0000-0000-0000-000000000001", "image/jpeg"),
    ).toBe(path);
    expect(isOwnedProfilePhotoPath(owner, path)).toBe(true);
    expect(isOwnedProfilePhotoPath(owner, `${otherOwner}/10000000-0000-0000-0000-000000000001.jpg`)).toBe(false);
    expect(isOwnedProfilePhotoPath(owner, `${owner}/../profile.png`)).toBe(false);
    expect(() => makeProfilePhotoPath(owner, "not-a-uuid", "image/png")).toThrow();
  });
});

describe("profile photo image verification", () => {
  it.each([
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
    ["webp", "image/webp"],
  ] as const)("fully decodes a valid %s", async (format, mime) => {
    const bytes = await imageBytes(format);
    expect(await isValidProfilePhoto(bytes, mime, bytes.length)).toBe(true);
  });

  it("rejects forged headers, a MIME mismatch, truncation and an incorrect byte count", async () => {
    const jpeg = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 210, g: 32, b: 48 },
      },
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    expect(await isValidProfilePhoto(Buffer.from("\xff\xd8\xff"), "image/jpeg", 3)).toBe(false);
    expect(await isValidProfilePhoto(jpeg, "image/png", jpeg.length)).toBe(false);
    expect(await isValidProfilePhoto(jpeg.subarray(0, 8), "image/jpeg", 8)).toBe(false);
    const truncated = jpeg.subarray(0, jpeg.length - 8);
    expect((await sharp(truncated).metadata()).width).toBeGreaterThan(0);
    expect(await isValidProfilePhoto(truncated, "image/jpeg", truncated.length)).toBe(false);
    expect(await isValidProfilePhoto(jpeg, "image/jpeg", jpeg.length + 1)).toBe(false);
  });
});

describe("profile photo actions", () => {
  it("requires an authenticated owner before reading or mutating an upload", async () => {
    let queried = false;
    const deps = dependencies({
      getUpload: async () => {
        queried = true;
        return null;
      },
    });
    expect(await finalizeProfilePhotoUpload(null, path, deps)).toEqual({ error: "unauthorized" });
    expect(await cancelProfilePhotoUpload(null, path, deps)).toEqual({ error: "unauthorized" });
    expect(queried).toBe(false);
  });

  it("rejects another owner's path before looking up its upload record", async () => {
    let queried = false;
    const deps = dependencies({
      getUpload: async () => {
        queried = true;
        return null;
      },
    });
    expect(await finalizeProfilePhotoUpload(owner, `${otherOwner}/10000000-0000-0000-0000-000000000001.jpg`, deps)).toEqual({ error: "invalid-path" });
    expect(queried).toBe(false);
  });

  it("retires and removes an invalid upload without replacing the existing photo", async () => {
    const deps = dependencies({
      getCurrentPath: async () => priorPath,
      readObject: async () => Buffer.from("not an image"),
    });
    const result = await finalizeProfilePhotoUpload(owner, path, deps);
    expect(result).toEqual({ error: "invalid-image" });
    expect(deps.removed).toEqual([path]);
    expect(await deps.getCurrentPath(owner)).toBe(priorPath);
  });

  it("commits a decoded photo and only then removes the replaced path", async () => {
    const bytes = await imageBytes("jpeg");
    const deps = dependencies({
      readObject: async () => bytes,
      getUpload: async () => ({
        ownerId: owner,
        state: "pending",
        contentType: "image/jpeg",
        expectedSize: bytes.length,
      }),
      commit: async () => priorPath,
    });
    expect(await finalizeProfilePhotoUpload(owner, path, deps)).toEqual({ photoUrl: "signed-photo-url" });
    expect(deps.removed).toEqual([priorPath]);
  });

  it("leaves the current photo in place when commit fails", async () => {
    const bytes = await imageBytes("jpeg");
    const deps = dependencies({
      readObject: async () => bytes,
      getUpload: async () => ({
        ownerId: owner,
        state: "pending",
        contentType: "image/jpeg",
        expectedSize: bytes.length,
      }),
      commit: async () => {
        throw new Error("database unavailable");
      },
      getCurrentPath: async () => priorPath,
    });
    expect(await finalizeProfilePhotoUpload(owner, path, deps)).toEqual({ error: "save-failed" });
    expect(deps.removed).toEqual([path]);
    expect(await deps.getCurrentPath(owner)).toBe(priorPath);
  });

  it("does not delete a photo when cancel loses a race to finalization", async () => {
    let reads = 0;
    const deps = dependencies({
      getUpload: async () => {
        reads += 1;
        return {
          ownerId: owner,
          state: reads === 1 ? "pending" : "active",
          contentType: "image/jpeg",
          expectedSize: 20,
        };
      },
      retire: async () => false,
      getCurrentPath: async () => path,
    });
    expect(await cancelProfilePhotoUpload(owner, path, deps)).toEqual({ photoUrl: "signed-photo-url" });
    expect(deps.removed).toEqual([]);
  });

  it("cleans up a path if the concurrent operation retired it", async () => {
    let reads = 0;
    const deps = dependencies({
      getUpload: async () => {
        reads += 1;
        return {
          ownerId: owner,
          state: reads === 1 ? "pending" : "retired",
          contentType: "image/jpeg",
          expectedSize: 20,
        };
      },
      retire: async () => false,
      getCurrentPath: async () => null,
    });
    await cancelProfilePhotoUpload(owner, path, deps);
    expect(deps.removed).toEqual([path]);
  });

  it("treats post-commit storage cleanup failure as saved and never restores the old photo", async () => {
    const result = await removeProfilePhoto(
      owner,
      async () => priorPath,
      async () => {
        throw new Error("storage unavailable");
      },
    );
    expect(result).toEqual({ photoUrl: null });
  });
});
