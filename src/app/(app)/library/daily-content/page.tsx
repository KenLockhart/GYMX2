import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DailyContentManager } from "@/components/daily-content/daily-content-manager";
import { readDailyContentPage } from "@/components/daily-content/page-number";
import { getT } from "@/i18n/server";
import { loadDailyContentPortal } from "@/lib/daily-content-server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).library.dailyContent.title };
}

export default async function CoachDailyContentPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const page = readDailyContentPage((await searchParams).page);
  const data = await loadDailyContentPortal({ page });
  if (data.role === "admin") redirect("/admin/daily-content");
  const t = (await getT()).library.dailyContent;
  return (
    <DailyContentManager
      data={data}
      copy={t}
      uploadHref="/library/upload?returnTo=%2Flibrary%2Fdaily-content"
    />
  );
}
