import Link from "next/link";
import { getT } from "@/i18n/server";

type CoachReminder = { coachName: string; startsAt: string };

export async function PendingMemberIntakeBanner({
  coaches,
}: {
  coaches: CoachReminder[];
}) {
  if (!coaches.length) return null;
  const t = (await getT()).intake;
  const first = coaches[0]!;
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-accent/50 bg-accent/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <h2 className="font-semibold">{t.pendingBannerTitle}</h2>
        <p className="text-sm text-muted">{t.pendingBannerBody(first.coachName)}</p>
        {coaches.length > 1 && <p className="text-xs text-muted">{t.pendingCount(coaches.length)}</p>}
      </div>
      <Link href="/intake" className="btn-primary shrink-0">{t.buttons.openIntake}</Link>
    </section>
  );
}
