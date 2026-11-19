import type { Metadata } from "next";
import { DailyContentManager } from "@/components/daily-content/daily-content-manager";
import { readDailyContentPage } from "@/components/daily-content/page-number";
import { getT } from "@/i18n/server";
import { requireAdmin } from "@/lib/auth";
import { loadDailyContentPortal } from "@/lib/daily-content-server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).library.dailyContent.title };
}

export default async function AdminDailyContentPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  await requireAdmin();
  const page = readDailyContentPage((await searchParams).page);
  const data = await loadDailyContentPortal({ page });
  if (data.role !== "admin") throw new Error("Admin Daily Content data mismatch.");
  const t = (await getT()).library.dailyContent;
  return (
    <DailyContentManager
      data={data}
      copy={t}
      uploadHref="/library/upload?returnTo=%2Fadmin%2Fdaily-content"
    />
  );
}
