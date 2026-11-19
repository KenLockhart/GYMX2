import type { Metadata } from "next";
import Link from "next/link";
import { getT } from "@/i18n/server";
import { requireCoachOrAdmin } from "@/lib/auth";
import { isStreamConfigured } from "@/lib/stream";
import { UploadForm } from "./upload-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).library.upload };
}

function uploadReturnTo(value: string | string[] | undefined, role: string) {
  const requested = Array.isArray(value) ? value[0] : value;
  if (role === "coach" && requested === "/library/daily-content")
    return "/library/daily-content";
  if (role === "admin" && requested === "/admin/daily-content")
    return "/admin/daily-content";
  return "/library";
}

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { profile } = await requireCoachOrAdmin();
  const returnTo = uploadReturnTo((await searchParams).returnTo, profile.role);
  const isDailyContentUpload = returnTo !== "/library";
  const t = (await getT()).library;

  return (
    <div className="space-y-6">
      <Link href={returnTo} className="text-link text-sm">
        {isDailyContentUpload ? t.dailyContent.open : t.back}
      </Link>
      <h1 className="text-5xl">{t.upload}</h1>
      {isDailyContentUpload && <p className="max-w-xl text-sm text-muted">{t.dailyContentUploadPrivacy}</p>}
      {isStreamConfigured() ? (
        <UploadForm returnTo={returnTo} dailyContentUpload={isDailyContentUpload} />
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
