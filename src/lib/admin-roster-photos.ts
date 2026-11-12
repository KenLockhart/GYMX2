import { PROFILE_PHOTO_BUCKET } from "./profile-photo-shared";

export const ADMIN_ROSTER_PROFILE_PHOTO_BUCKET = PROFILE_PHOTO_BUCKET;
export const ADMIN_ROSTER_COACH_PHOTO_BUCKET = "coach-photos";
export const ADMIN_ROSTER_PHOTO_URL_TTL_SECONDS = 60 * 60;

export type AdminRosterPhotoBucket =
  | typeof ADMIN_ROSTER_PROFILE_PHOTO_BUCKET
  | typeof ADMIN_ROSTER_COACH_PHOTO_BUCKET;

export type AdminRosterPhotoRow = {
  user_id: string;
  photo_path: string | null;
};

export type AdminRosterCoachPhotoRow = {
  coach_id: string;
  photo_path: string | null;
};

export type AdminRosterSignedPhoto = {
  path: string;
  signedUrl: string | null;
};

export type AdminRosterPhotoSources = {
  userIds: readonly string[];
  accountPhotos: readonly AdminRosterPhotoRow[];
  coachDrafts: readonly AdminRosterCoachPhotoRow[];
  publishedCoaches: readonly AdminRosterCoachPhotoRow[];
  signBatch: (
    bucket: AdminRosterPhotoBucket,
    paths: readonly string[],
  ) => Promise<readonly AdminRosterSignedPhoto[]>;
};

type PhotoCandidate = {
  userId: string;
  path: string;
  bucket: AdminRosterPhotoBucket;
};

// This only returns signed URLs. Raw private object paths stay on the server.
export async function resolveAdminRosterPhotoUrls({
  userIds,
  accountPhotos,
  coachDrafts,
  publishedCoaches,
  signBatch,
}: AdminRosterPhotoSources): Promise<Map<string, string>> {
  const inScope = new Set(userIds);
  const candidates: PhotoCandidate[] = [];

  const addRows = (
    rows: readonly { userId: string; photoPath: string | null }[],
    bucket: AdminRosterPhotoBucket,
  ) => {
    for (const row of rows) {
      const path = row.photoPath;
      if (inScope.has(row.userId) && path)
        candidates.push({ userId: row.userId, path, bucket });
    }
  };

  // Candidate insertion order is the explicit precedence order.
  addRows(
    accountPhotos.map(({ user_id, photo_path }) => ({
      userId: user_id,
      photoPath: photo_path,
    })),
    ADMIN_ROSTER_PROFILE_PHOTO_BUCKET,
  );
  addRows(
    coachDrafts.map(({ coach_id, photo_path }) => ({
      userId: coach_id,
      photoPath: photo_path,
    })),
    ADMIN_ROSTER_COACH_PHOTO_BUCKET,
  );
  addRows(
    publishedCoaches.map(({ coach_id, photo_path }) => ({
      userId: coach_id,
      photoPath: photo_path,
    })),
    ADMIN_ROSTER_COACH_PHOTO_BUCKET,
  );

  const pathsByBucket = new Map<AdminRosterPhotoBucket, string[]>([
    [ADMIN_ROSTER_PROFILE_PHOTO_BUCKET, []],
    [ADMIN_ROSTER_COACH_PHOTO_BUCKET, []],
  ]);
  const seenPaths = new Map<AdminRosterPhotoBucket, Set<string>>([
    [ADMIN_ROSTER_PROFILE_PHOTO_BUCKET, new Set()],
    [ADMIN_ROSTER_COACH_PHOTO_BUCKET, new Set()],
  ]);
  for (const candidate of candidates) {
    const seen = seenPaths.get(candidate.bucket)!;
    if (seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    pathsByBucket.get(candidate.bucket)!.push(candidate.path);
  }

  const signedByBucket = new Map<
    AdminRosterPhotoBucket,
    Map<string, string>
  >();
  await Promise.all(
    [...pathsByBucket].map(async ([bucket, paths]) => {
      if (!paths.length) return;
      try {
        const signed = await signBatch(bucket, paths);
        const requested = new Set(paths);
        signedByBucket.set(
          bucket,
          new Map(
            signed.flatMap((item) =>
              item.signedUrl && requested.has(item.path)
                ? [[item.path, item.signedUrl] as const]
                : [],
            ),
          ),
        );
      } catch {
        // A failed bucket does not prevent a lower-priority source from working.
        signedByBucket.set(bucket, new Map());
      }
    }),
  );

  const photoUrls = new Map<string, string>();
  for (const candidate of candidates) {
    if (photoUrls.has(candidate.userId)) continue;
    const signedUrl = signedByBucket
      .get(candidate.bucket)
      ?.get(candidate.path);
    if (signedUrl) photoUrls.set(candidate.userId, signedUrl);
  }
  return photoUrls;
}
