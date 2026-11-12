"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth";
import {
  cancelProfilePhotoUpload,
  finalizeProfilePhotoUpload,
  removeProfilePhoto,
  type ProfilePhotoDependencies,
} from "@/lib/profile-photo";
import {
  isOwnedProfilePhotoPath,
  makeProfilePhotoPath,
  PROFILE_PHOTO_BUCKET,
  validateProfilePhotoDescriptor,
  type ProfilePhotoMimeType,
  type ProfilePhotoState,
} from "@/lib/profile-photo-shared";
import { createAdminClient } from "@/lib/supabase/admin";

function makePhotoDependencies(ownerId: string): ProfilePhotoDependencies {
  const admin = createAdminClient();
  const storage = admin.storage.from(PROFILE_PHOTO_BUCKET);

  return {
    async getUpload(userId, path) {
      const { data, error } = await admin
        .from("profile_photo_uploads")
        .select("owner_id, state, content_type, expected_size")
        .eq("owner_id", userId)
        .eq("path", path)
        .maybeSingle();
      if (error || !data || userId !== ownerId) return null;
      if (!["pending", "active", "retired"].includes(data.state)) return null;
      if (
        !Object.hasOwn(
          { "image/jpeg": true, "image/png": true, "image/webp": true },
          data.content_type,
        )
      )
        return null;
      return {
        ownerId: data.owner_id,
        state: data.state as ProfilePhotoState,
        contentType: data.content_type as ProfilePhotoMimeType,
        expectedSize: data.expected_size,
      };
    },
    async getCurrentPath(userId) {
      const { data } = await admin
        .from("profile_photos")
        .select("photo_path")
        .eq("user_id", userId)
        .maybeSingle();
      return data?.photo_path ?? null;
    },
    async readObject(path) {
      const { data, error } = await storage.download(path);
      return error || !data ? null : Buffer.from(await data.arrayBuffer());
    },
    async commit(userId, path) {
      const { data, error } = await admin.rpc("commit_profile_photo_upload", {
        target_owner_id: userId,
        target_path: path,
      });
      if (error) throw error;
      return typeof data === "string" ? data : null;
    },
    async retire(userId, path) {
      const { data, error } = await admin.rpc("retire_profile_photo_upload", {
        target_owner_id: userId,
        target_path: path,
      });
      if (error) throw error;
      return data === true;
    },
    async removeObject(path) {
      const { error } = await storage.remove([path]);
      if (error) throw error;
    },
    async signedUrl(path) {
      const { data, error } = await storage.createSignedUrl(path, 60 * 60);
      return error ? null : data?.signedUrl ?? null;
    },
  };
}

export async function prepareMyProfilePhotoUpload(input: unknown): Promise<{
  error?: "invalid-type" | "too-large" | "save-failed";
  path?: string;
  token?: string;
  contentType?: ProfilePhotoMimeType;
}> {
  const { profile } = await requireAccount();
  const descriptor = validateProfilePhotoDescriptor(input);
  if ("error" in descriptor) return { error: descriptor.error };

  const path = makeProfilePhotoPath(
    profile.id,
    randomUUID(),
    descriptor.contentType,
  );
  const admin = createAdminClient();
  const { error: registerError } = await admin.rpc(
    "register_profile_photo_upload",
    {
      target_owner_id: profile.id,
      target_path: path,
      target_content_type: descriptor.contentType,
      target_expected_size: descriptor.size,
    },
  );
  if (registerError) return { error: "save-failed" };

  const { data, error } = await admin.storage
    .from(PROFILE_PHOTO_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    const dependencies = makePhotoDependencies(profile.id);
    const retired = await dependencies.retire(profile.id, path).catch(() => false);
    if (retired) await dependencies.removeObject(path).catch(() => undefined);
    return { error: "save-failed" };
  }

  return {
    path: data.path,
    token: data.token,
    contentType: descriptor.contentType,
  };
}

export async function finishMyProfilePhotoUpload(
  path: unknown,
): Promise<{ error?: string; photoUrl?: string | null }> {
  const { profile } = await requireAccount();
  if (!isOwnedProfilePhotoPath(profile.id, path)) return { error: "invalid-path" };
  const result = await finalizeProfilePhotoUpload(
    profile.id,
    path,
    makePhotoDependencies(profile.id),
  );
  if (!result.error) {
    revalidatePath("/profile");
    revalidatePath("/admin/users");
  }
  return result;
}

export async function cancelMyProfilePhotoUpload(
  path: unknown,
): Promise<{ error?: string }> {
  const { profile } = await requireAccount();
  if (!isOwnedProfilePhotoPath(profile.id, path)) return { error: "invalid-path" };
  const result = await cancelProfilePhotoUpload(
    profile.id,
    path,
    makePhotoDependencies(profile.id),
  );
  return result.error ? { error: result.error } : {};
}

export async function removeMyProfilePhoto(): Promise<{
  error?: string;
  photoUrl?: string | null;
}> {
  const { profile } = await requireAccount();
  const admin = createAdminClient();
  const result = await removeProfilePhoto(
    profile.id,
    async (userId) => {
      const { data, error } = await admin.rpc("remove_profile_photo", {
        target_owner_id: userId,
      });
      if (error) throw error;
      return typeof data === "string" ? data : null;
    },
    async (path) => {
      const { error } = await admin.storage.from(PROFILE_PHOTO_BUCKET).remove([path]);
      if (error) throw error;
    },
  );
  if (!result.error) {
    revalidatePath("/profile");
    revalidatePath("/admin/users");
  }
  return result;
}
