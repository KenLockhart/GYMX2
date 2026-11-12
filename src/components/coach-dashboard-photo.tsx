"use client";

import Image from "next/image";
import { UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import styles from "./coach-dashboard.module.css";

export function CoachDashboardPhoto({
  photoUrl,
  photoAlt,
  missingLabel,
  addPhotoLabel,
}: {
  photoUrl: string | null;
  photoAlt: string;
  missingLabel: string;
  addPhotoLabel: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const hasPhoto = Boolean(photoUrl) && failedUrl !== photoUrl;

  return (
    <div className={styles.photoFrame}>
      {hasPhoto && (
        <Image
          src={photoUrl!}
          alt={photoAlt}
          width={880}
          height={1100}
          unoptimized
          className={styles.photoImage}
          onError={() => setFailedUrl(photoUrl)}
        />
      )}
      {!hasPhoto && (
        <div className={styles.photoFallback}>
          <span className={styles.fallbackIcon} aria-hidden="true">
            <UserRound size={40} strokeWidth={1.4} />
          </span>
          <span>{missingLabel}</span>
          <Link className={styles.link} href="/profile">
            {addPhotoLabel}
          </Link>
        </div>
      )}
    </div>
  );
}
