export const PROFILE_PHOTO_BUCKET = "profile-photos";
export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export const PROFILE_PHOTO_TYPES = {
  "image/jpeg": { extension: "jpg", format: "jpeg" },
  "image/png": { extension: "png", format: "png" },
  "image/webp": { extension: "webp", format: "webp" },
} as const;

export type ProfilePhotoMimeType = keyof typeof PROFILE_PHOTO_TYPES;
export type ProfilePhotoState = "pending" | "active" | "retired";

export type ProfilePhotoUpload = {
  ownerId: string;
  state: ProfilePhotoState;
  contentType: ProfilePhotoMimeType;
  expectedSize: number;
};

export type ProfilePhotoError =
  | "unauthorized"
  | "invalid-type"
  | "too-large"
  | "invalid-path"
  | "upload-unavailable"
  | "upload-missing"
  | "invalid-image"
  | "save-failed"
  | "remove-failed";

export type ProfilePhotoActionResult = {
  error?: ProfilePhotoError;
  photoUrl?: string | null;
};

export function validateProfilePhotoDescriptor(input: unknown):
  | { error: "invalid-type" | "too-large" }
  | { contentType: ProfilePhotoMimeType; size: number } {
  if (!input || typeof input !== "object") return { error: "invalid-type" };
  const descriptor = input as { contentType?: unknown; size?: unknown };
  if (
    typeof descriptor.contentType !== "string" ||
    !Object.hasOwn(PROFILE_PHOTO_TYPES, descriptor.contentType)
  ) {
    return { error: "invalid-type" };
  }
  if (
    typeof descriptor.size !== "number" ||
    !Number.isSafeInteger(descriptor.size) ||
    descriptor.size <= 0 ||
    descriptor.size > PROFILE_PHOTO_MAX_BYTES
  ) {
    return { error: "too-large" };
  }
  return {
    contentType: descriptor.contentType as ProfilePhotoMimeType,
    size: descriptor.size,
  };
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function makeProfilePhotoPath(
  userId: string,
  uploadId: string,
  contentType: ProfilePhotoMimeType,
) {
  const type = PROFILE_PHOTO_TYPES[contentType];
  if (!type || !new RegExp(`^${UUID}$`, "i").test(userId))
    throw new Error("Invalid profile photo identity");
  if (!new RegExp(`^${UUID}$`, "i").test(uploadId))
    throw new Error("Invalid profile photo upload id");
  return `${userId}/${uploadId}.${type.extension}`;
}

export function isOwnedProfilePhotoPath(userId: string, path: unknown): path is string {
  if (typeof path !== "string") return false;
  const match = new RegExp(`^(${UUID})/(${UUID})\\.(jpg|png|webp)$`, "i").exec(path);
  return Boolean(match && match[1].toLowerCase() === userId.toLowerCase());
}
