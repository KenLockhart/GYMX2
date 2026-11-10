import Link from "next/link";
import type { ReactNode } from "react";
import { LocalDateTime } from "@/components/coach-profile/profile-client";
import { COACH_STYLE } from "@/lib/coach-options";
import { formatPrice } from "@/lib/coach-profile";
import type { CoachCard } from "@/lib/discovery";
import type { OpenSlot } from "@/lib/intros";

function styleLabel(
  group: "motivation" | "accountability",
  value: string | null,
) {
  return (
    COACH_STYLE[group].options.find((o) => o.value === value)?.label ?? "—"
  );
}

function formats(card: CoachCard) {
  return card.formats.includes("online") && card.formats.includes("in_person")
    ? "Online & in-person"
    : card.formats.includes("in_person")
      ? "In-person"
      : "Online";
}

// Two or three coaches side by side. The first column stays put while the table scrolls on phones.
export function CompareTable({
  cards,
  nextIntro,
  isMember,
}: {
  cards: CoachCard[];
  nextIntro: (OpenSlot | null)[];
  isMember: boolean;
}) {
  // Each row: a label and one cell per coach. The best value in a row is highlighted.
  const best = (values: (number | null)[], high = true) => {
    const real = values.filter((v): v is number => v !== null);
    if (real.length < 2) return -1;
    const target = high ? Math.max(...real) : Math.min(...real);
    return real.filter((v) => v === target).length === 1
      ? values.indexOf(target)
      : -1;
  };
  const rows: { label: string; cells: ReactNode[]; highlight?: number }[] = [
    ...(isMember
      ? [
          {
            label: "Your match",
            cells: cards.map((c) =>
              c.match?.eligible && c.match.total !== null
                ? `${c.match.total}%`
                : c.match && !c.match.eligible
                  ? "Not a match now"
                  : c.hasProfile
                    ? "Take the quiz"
                    : "—",
            ),
            highlight: best(
              cards.map((c) => (c.match?.eligible ? c.match.total : null)),
            ),
          },
        ]
      : []),
    {
      label: "Rating",
      cells: cards.map((c) =>
        c.rating
          ? `★ ${c.rating.average} (${c.rating.count})`
          : "No reviews yet",
      ),
      highlight: best(cards.map((c) => c.rating?.average ?? null)),
    },
    {
      label: "Experience",
      cells: cards.map((c) =>
        c.experienceYears !== null ? `${c.experienceYears} years` : "—",
      ),
      highlight: best(cards.map((c) => c.experienceYears)),
    },
    {
      label: "Plans from",
      cells: cards.map((c) =>
        c.startingPriceCents !== null
          ? `${formatPrice(c.startingPriceCents)}/mo`
          : "Ask",
      ),
      highlight: best(
        cards.map((c) => c.startingPriceCents),
        false,
      ),
    },
    {
      label: "Free intro",
      cells: nextIntro.map((slot) =>
        slot ? (
          <span key={slot.id}>
            Next: <LocalDateTime iso={slot.startsAt} />
          </span>
        ) : (
          "No open times"
        ),
      ),
    },
    {
      label: "New clients",
      cells: cards.map((c) => (c.acceptingClients ? "Accepting" : "Waitlist")),
    },
    {
      label: "Verified credentials",
      cells: cards.map((c) => (c.verified ? "✓ Verified" : "Not yet")),
    },
    { label: "Training", cells: cards.map(formats) },
    { label: "Location", cells: cards.map((c) => c.location || "—") },
    {
      label: "Specialties",
      cells: cards.map((c) => c.specialties.join(", ") || "—"),
    },
    {
      label: "Coaching style",
      cells: cards.map((c) => styleLabel("motivation", c.motivation)),
    },
    {
      label: "Accountability",
      cells: cards.map((c) => styleLabel("accountability", c.accountability)),
    },
    {
      label: "Works with",
      cells: cards.map((c) => c.populations.slice(0, 4).join(", ") || "—"),
    },
    { label: "Languages", cells: cards.map((c) => c.languages || "—") },
  ];

  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[36rem] table-fixed border-separate border-spacing-0 text-sm">
        <caption className="sr-only">Coaches side by side</caption>
        <colgroup>
          <col className="w-32 sm:w-44" />
          {cards.map((c) => (
            <col key={c.id} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <td className="sticky left-0 z-10 bg-background" />
            {cards.map((c) => (
              <th
                key={c.id}
                scope="col"
                className="px-2 pb-4 text-left align-top font-normal"
              >
                <div className="overflow-hidden rounded-2xl border border-border bg-surface">
                  <div className="aspect-[4/3] bg-surface-raised">
                    {c.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- signed storage link
                      <img
                        src={c.photoUrl}
                        alt=""
                        className="size-full object-cover object-top"
                      />
                    ) : (
                      <div
                        aria-hidden
                        className="grid size-full place-items-center font-display text-5xl font-bold text-accent/70"
                        style={{
                          background:
                            "radial-gradient(100% 80% at 80% 10%, rgba(200,241,53,0.22), transparent 60%), linear-gradient(160deg,#20241d,#0d0f0c)",
                        }}
                      >
                        {c.name
                          .replace(/^Coach\s+/i, "")
                          .charAt(0)
                          .toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="space-y-2 p-3">
                    <p className="font-semibold leading-snug [overflow-wrap:anywhere]">
                      {c.name}
                    </p>
                    <div className="flex flex-col gap-1.5">
                      <Link
                        href={`/coaches/${c.id}`}
                        className="btn-primary px-3 py-1.5 text-sm"
                      >
                        View profile
                      </Link>
                      {isMember && nextIntro[cards.indexOf(c)] && (
                        <Link
                          href={`/coaches/${c.id}/intro`}
                          className="btn-secondary px-3 py-1.5 text-sm"
                        >
                          Book free intro
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th
                scope="row"
                className="sticky left-0 z-10 border-t border-border bg-background py-3 pr-3 text-left align-top font-medium text-muted"
              >
                {row.label}
              </th>
              {row.cells.map((cell, i) => (
                <td
                  key={cards[i].id}
                  className={`border-t border-border px-2 py-3 align-top [overflow-wrap:anywhere] ${row.highlight === i ? "font-semibold text-accent" : ""}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
