import type { Metadata } from "next";
import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { isStreamConfigured } from "@/lib/stream";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Upload a video" };

export default async function UploadPage() {
  await requireCoach();

  return (
    <div className="space-y-6">
      <Link href="/library" className="text-link text-sm">
        Back to the library
      </Link>
      <h1 className="text-5xl">Upload a video</h1>
      {isStreamConfigured() ? (
        <UploadForm />
      ) : (
        <p
          role="status"
          className="rounded-lg border border-border bg-surface p-4 text-muted"
        >
          Video uploads aren&apos;t connected yet.
        </p>
      )}
    </div>
  );
}
