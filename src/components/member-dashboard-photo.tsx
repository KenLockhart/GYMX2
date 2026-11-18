"use client";

import Image from "next/image";
import { UserRound } from "lucide-react";
import { useState } from "react";

export function MemberDashboardPhoto({
  photoUrl,
  photoAlt,
  missingLabel,
}: {
  photoUrl: string | null;
  photoAlt: string;
  missingLabel: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const hasPhoto = Boolean(photoUrl) && failedUrl !== photoUrl;

  return (
    <div className="memberPhotoFrame">
      {hasPhoto && (
        <Image
          src={photoUrl!}
          alt={photoAlt}
          width={880}
          height={1100}
          unoptimized
          className="memberPhotoImage"
          onError={() => setFailedUrl(photoUrl)}
        />
      )}
      {!hasPhoto && (
        <div className="memberPhotoFallback">
          <span className="memberFallbackIcon" aria-hidden="true">
            <UserRound size={40} strokeWidth={1.4} />
          </span>
          <span>{missingLabel}</span>
        </div>
      )}
    </div>
  );
}
