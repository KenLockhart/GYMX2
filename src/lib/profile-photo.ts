import sharp from "sharp";
export const PROFILE_PHOTO_MAX_PIXELS = 20_000_000;
import {
  isOwnedProfilePhotoPath,
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_TYPES,
  type ProfilePhotoActionResult,
  type ProfilePhotoMimeType,
  type ProfilePhotoUpload,
} from "./profile-photo-shared";

export type { ProfilePhotoActionResult, ProfilePhotoMimeType, ProfilePhotoUpload } from "./profile-photo-shared";

export async function isValidProfilePhoto(
  bytes: Buffer,
  contentType: ProfilePhotoMimeType,
  expectedSize: number,
) {
  if (
    !bytes.length ||
    bytes.length !== expectedSize ||
    bytes.length > PROFILE_PHOTO_MAX_BYTES
  ) {
    return false;
  }

  try {
    const image = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: PROFILE_PHOTO_MAX_PIXELS,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    const expected = PROFILE_PHOTO_TYPES[contentType];
    if (
      metadata.format !== expected.format ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > PROFILE_PHOTO_MAX_PIXELS ||
      (metadata.pages ?? 1) !== 1
    ) {
      return false;
    }

    // metadata() only inspects headers. stats() forces libvips to decode the pixel data too,
    // catching files with forged headers, truncated image streams, and corrupt compressed data.
    await image.stats();
    return true;
  } catch {
    return false;
  }
}

export type ProfilePhotoDependencies = {
  getUpload(ownerId: string, path: string): Promise<ProfilePhotoUpload | null>;
  getCurrentPath(ownerId: string): Promise<string | null>;
  readObject(path: string): Promise<Buffer | null>;
  commit(ownerId: string, path: string): Promise<string | null>;
  retire(ownerId: string, path: string): Promise<boolean>;
  removeObject(path: string): Promise<void>;
  signedUrl(path: string): Promise<string | null>;
};

async function removeBestEffort(dependencies: ProfilePhotoDependencies, path: string) {
  try {
    await dependencies.removeObject(path);
  } catch {
    // The retired upload row still blocks access and replay; account deletion also sweeps storage.
  }
}

export async function cancelProfilePhotoUpload(
  ownerId: string | null,
  path: unknown,
  dependencies: ProfilePhotoDependencies,
): Promise<ProfilePhotoActionResult> {
  if (!ownerId) return { error: "unauthorized" };
  if (!isOwnedProfilePhotoPath(ownerId, path)) return { error: "invalid-path" };
  const upload = await dependencies.getUpload(ownerId, path);
  if (!upload || upload.ownerId !== ownerId) return { error: "upload-unavailable" };
  if (upload.state === "active") return { photoUrl: await dependencies.signedUrl(path) };

  if (upload.state === "pending") {
    let retired = false;
    try {
      retired = await dependencies.retire(ownerId, path);
    } catch {
      // A failed state change must never be followed by deletion of a possibly active object.
    }
    if (!retired) {
      const latest = await dependencies.getUpload(ownerId, path);
      if (latest?.state === "active")
        return { photoUrl: await dependencies.signedUrl(path) };
      if (latest?.state !== "retired") return {};
    }
  }
  await removeBestEffort(dependencies, path);
  return {};
}

export async function finalizeProfilePhotoUpload(
  ownerId: string | null,
  path: unknown,
  dependencies: ProfilePhotoDependencies,
): Promise<ProfilePhotoActionResult> {
  if (!ownerId) return { error: "unauthorized" };
  if (!isOwnedProfilePhotoPath(ownerId, path)) return { error: "invalid-path" };
  const upload = await dependencies.getUpload(ownerId, path);
  if (!upload || upload.ownerId !== ownerId) return { error: "upload-unavailable" };

  if (upload.state === "active") {
    const currentPath = await dependencies.getCurrentPath(ownerId);
    return currentPath === path
      ? { photoUrl: await dependencies.signedUrl(path) }
      : { error: "upload-unavailable" };
  }
  if (upload.state === "retired") {
    await removeBestEffort(dependencies, path);
    return { error: "upload-unavailable" };
  }

  const bytes = await dependencies.readObject(path);
  if (!bytes) return { error: "upload-missing" };
  if (!(await isValidProfilePhoto(bytes, upload.contentType, upload.expectedSize))) {
    const retired = await dependencies.retire(ownerId, path);
    if (retired || (await dependencies.getUpload(ownerId, path))?.state === "retired")
      await removeBestEffort(dependencies, path);
    return { error: "invalid-image" };
  }

  let replacedPath: string | null;
  try {
    replacedPath = await dependencies.commit(ownerId, path);
  } catch {
    const latest = await dependencies.getUpload(ownerId, path);
    if (latest?.state === "active" && (await dependencies.getCurrentPath(ownerId)) === path) {
      return { photoUrl: await dependencies.signedUrl(path) };
    }
    if (latest?.state === "retired") await removeBestEffort(dependencies, path);
    else if (latest?.state === "pending") {
      let retired = false;
      try {
        retired = await dependencies.retire(ownerId, path);
      } catch {
        // Keep the object if its state could not be read or changed safely.
      }
      if (retired || (await dependencies.getUpload(ownerId, path))?.state === "retired")
        await removeBestEffort(dependencies, path);
    }
    return { error: "save-failed" };
  }

  if (replacedPath && replacedPath !== path)
    await removeBestEffort(dependencies, replacedPath);
  return { photoUrl: await dependencies.signedUrl(path) };
}

export async function removeProfilePhoto(
  ownerId: string | null,
  removeCurrent: (ownerId: string) => Promise<string | null>,
  removeObject: (path: string) => Promise<void>,
): Promise<ProfilePhotoActionResult> {
  if (!ownerId) return { error: "unauthorized" };
  let path: string | null;
  try {
    path = await removeCurrent(ownerId);
  } catch {
    return { error: "remove-failed" };
  }
  if (path) {
    try {
      await removeObject(path);
    } catch {
      // The database no longer exposes the path; cleanup can be retried without restoring it.
    }
  }
  return { photoUrl: null };
}
