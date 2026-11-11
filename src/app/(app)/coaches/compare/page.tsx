import type { Metadata } from "next";
import Link from "next/link";
import { CompareTable } from "@/components/compare-table";
import { requireAccount } from "@/lib/auth";
import { loadDiscoveryCards } from "@/lib/discovery-server";
import { loadOpenSlots } from "@/lib/intros-server";
import { idSchema } from "@/lib/validation";
import { T } from "@/i18n/t";
import { getTr } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTr())("Compare coaches") };
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { profile } = await requireAccount();
  const ids = [...new Set((await searchParams).ids?.split(",") ?? [])]
    .filter((id) => idSchema.safeParse(id).success)
    .slice(0, 3);
  const all =
    ids.length >= 2
      ? await loadDiscoveryCards({ id: profile.id, role: profile.role })
      : [];
  const cards = ids.flatMap((id) =>
    all.filter((card) => card.id === id && !card.blocked),
  );
  const nextIntro = await Promise.all(
    cards.map((card) =>
      card.hasProfile ? loadOpenSlots(card.id).then((s) => s[0] ?? null) : null,
    ),
  );
  const isMember = profile.role === "member";

  if (cards.length < 2)
    return (
      <div className="space-y-4">
        <h1 className="text-5xl">
          <T>Compare coaches</T>
        </h1>
        <p className="text-muted">
          <T>
            Tick &ldquo;Compare&rdquo; on two or three coaches, then choose
            Compare.
          </T>
        </p>
        <Link href="/coaches" className="btn-primary">
          <T>Browse coaches</T>
        </Link>
      </div>
    );

  return (
    <div className="space-y-6">
      <div>
        <Link href="/coaches" className="text-link text-sm">
          <T>Back to coaches</T>
        </Link>
        <h1 className="mt-2 text-5xl">
          <T>Compare coaches</T>
        </h1>
        <p className="mt-2 max-w-xl text-muted">
          <T>
            The best value in each row is highlighted. Everything here comes
            from each coach&apos;s approved profile.
          </T>
        </p>
      </div>
      <CompareTable cards={cards} nextIntro={nextIntro} isMember={isMember} />
    </div>
  );
}
