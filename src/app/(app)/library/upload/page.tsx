import type { Metadata } from "next";
import Link from "next/link";
import { getT } from "@/i18n/server";
import { requireCoach } from "@/lib/auth";
import { isStreamConfigured } from "@/lib/stream";
import { UploadForm } from "./upload-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).library.upload };
}

export default async function UploadPage() {
  await requireCoach();
  const t = (await getT()).library;

  return (
    <div className="space-y-6">
      <Link href="/library" className="text-link text-sm">
        {t.back}
      </Link>
      <h1 className="text-5xl">{t.upload}</h1>
      {isStreamConfigured() ? (
        <UploadForm />
      ) : (
        <p
          role="status"
          className="rounded-lg border border-border bg-surface p-4 text-muted"
        >
          {t.uploadsOff}
        </p>
      )}
    </div>
  );
}
