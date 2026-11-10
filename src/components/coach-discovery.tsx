"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { setPassed, setSaved } from "@/app/(app)/coaches/discovery-actions";
import { unblockCoach } from "@/app/(app)/coaches/safety-actions";
import { COACH_STYLE, POPULATIONS } from "@/lib/coach-options";
import { formatPrice } from "@/lib/coach-profile";
import {
  activeFilterCount,
  type CoachCard,
  type DiscoveryFilters,
  type DiscoverySort,
  filterCoaches,
  NO_FILTERS,
  sortCoaches,
} from "@/lib/discovery";

type Tab = "all" | "saved" | "passed" | "blocked";

function Portrait({
  card,
  className = "",
}: {
  card: CoachCard;
  className?: string;
}) {
  return (
    <div className={`relative overflow-hidden bg-surface-raised ${className}`}>
      {card.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage link
        <img
          src={card.photoUrl}
          alt={`Portrait of ${card.name}`}
          className="size-full object-cover object-top"
        />
      ) : (
        <div
          aria-hidden
          className="grid size-full place-items-center font-display text-7xl font-bold text-accent/70"
          style={{
            background:
              "radial-gradient(100% 80% at 80% 10%, rgba(200,241,53,0.22), transparent 60%), linear-gradient(160deg,#20241d,#0d0f0c)",
          }}
        >
          {card.name
            .replace(/^Coach\s+/i, "")
            .charAt(0)
            .toUpperCase()}
        </div>
      )}
      <div className="absolute left-2 top-2 flex flex-wrap gap-1">
        {card.match?.eligible && card.match.total !== null && (
          <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-foreground">
            {card.match.total}% match
          </span>
        )}
        {card.match && !card.match.eligible && (
          <span className="rounded-full bg-background/85 px-2 py-0.5 text-xs text-muted">
            Not a match now
          </span>
        )}
        {!card.acceptingClients && card.hasProfile && (
          <span className="rounded-full bg-background/85 px-2 py-0.5 text-xs text-muted">
            Waitlist
          </span>
        )}
      </div>
    </div>
  );
}

function Facts({ card }: { card: CoachCard }) {
  return (
    <div className="space-y-1.5">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link
          href={`/coaches/${card.id}`}
          className="text-lg font-semibold hover:text-accent"
        >
          {card.name}
        </Link>
        {card.verified && (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className="size-3.5"
            >
              <path d="M9 12.5l2 2 4-4.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
            </svg>
            Verified
          </span>
        )}
      </p>
      {card.specialties.length > 0 && (
        <p className="text-sm font-semibold">{card.specialties.join(" • ")}</p>
      )}
      <p className="text-sm text-muted">
        {[
          card.location,
          card.formats.includes("online") && card.formats.includes("in_person")
            ? "Online & in-person"
            : card.formats.includes("in_person")
              ? "In-person"
              : "Online",
        ]
          .filter(Boolean)
          .join(" • ")}
      </p>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
        {card.rating ? (
          <span>
            <span aria-hidden className="text-accent">
              ★
            </span>{" "}
            {card.rating.average}{" "}
            <span className="text-muted">({card.rating.count})</span>
          </span>
        ) : (
          <span className="text-muted">No reviews yet</span>
        )}
        {card.experienceYears !== null && (
          <span>{card.experienceYears} yrs</span>
        )}
        {card.startingPriceCents !== null && (
          <span>from {formatPrice(card.startingPriceCents)}/mo</span>
        )}
      </p>
      {card.headline && (
        <p className="line-clamp-2 text-sm italic text-muted">
          &ldquo;{card.headline}&rdquo;
        </p>
      )}
      {!card.hasProfile && (
        <p className="text-xs text-muted">Full profile coming soon</p>
      )}
    </div>
  );
}

export function CoachDiscovery({
  cards: initial,
  canSave,
}: {
  cards: CoachCard[];
  canSave: boolean;
}) {
  const [cards, setCards] = useState(initial);
  const [filters, setFilters] = useState<DiscoveryFilters>(NO_FILTERS);
  const [sort, setSort] = useState<DiscoverySort>("match");
  const [tab, setTab] = useState<Tab>("all");
  const [view, setView] = useState<"grid" | "stack">("grid");
  const [error, setError] = useState<string | null>(null);
  // Up to three coaches to compare side by side.
  const [compare, setCompare] = useState<string[]>([]);
  const toggleCompare = (id: string) =>
    setCompare((list) =>
      list.includes(id)
        ? list.filter((x) => x !== id)
        : list.length >= 3
          ? list
          : [...list, id],
    );
  const [, start] = useTransition();

  const shown = useMemo(() => {
    const inTab = cards.filter((c) =>
      tab === "blocked"
        ? c.blocked
        : c.blocked
          ? false
          : tab === "saved"
            ? c.saved
            : tab === "passed"
              ? c.passed
              : !c.passed,
    );
    return sortCoaches(filterCoaches(inTab, filters), sort);
  }, [cards, filters, sort, tab]);

  function flag(id: string, kind: "saved" | "passed", on: boolean) {
    setError(null);
    const before = cards;
    // Saving and passing are opposites: doing one undoes the other.
    setCards((current) =>
      current.map((c) =>
        c.id !== id
          ? c
          : {
              ...c,
              [kind]: on,
              ...(on ? { [kind === "saved" ? "passed" : "saved"]: false } : {}),
            },
      ),
    );
    const card = cards.find((c) => c.id === id);
    start(async () => {
      const result =
        kind === "saved" ? await setSaved(id, on) : await setPassed(id, on);
      if (!result.error && on) {
        if (kind === "saved" && card?.passed) await setPassed(id, false);
        if (kind === "passed" && card?.saved) await setSaved(id, false);
      }
      if (result.error) {
        setCards(before);
        setError(result.error);
      }
    });
  }

  const count = activeFilterCount(filters);
  const visible = cards.filter((c) => !c.blocked);
  const counts = {
    all: visible.filter((c) => !c.passed).length,
    saved: visible.filter((c) => c.saved).length,
    passed: visible.filter((c) => c.passed).length,
    blocked: cards.filter((c) => c.blocked).length,
  };

  function unblock(id: string) {
    setError(null);
    start(async () => {
      const result = await unblockCoach(id);
      if (result.error) setError(result.error);
      else
        setCards((current) =>
          current.map((c) => (c.id === id ? { ...c, blocked: false } : c)),
        );
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Which coaches"
          className="flex gap-1 rounded-full border border-border p-1"
        >
          {(["all", "saved", "passed", "blocked"] as const)
            .filter(
              (t) =>
                (canSave || t === "all") &&
                (t !== "blocked" || counts.blocked > 0 || tab === "blocked"),
            )
            .map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`rounded-full px-3 py-1.5 text-sm ${tab === t ? "bg-accent font-semibold text-accent-foreground" : "text-muted hover:text-foreground"}`}
              >
                {t === "all"
                  ? "Coaches"
                  : t === "saved"
                    ? "Saved"
                    : t === "passed"
                      ? "Passed"
                      : "Blocked"}{" "}
                ({counts[t]})
              </button>
            ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="sort">
            Sort
          </label>
          <select
            id="sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as DiscoverySort)}
            className="field-input w-auto py-2 text-sm"
          >
            <option value="match">Best match</option>
            <option value="rating">Top rated</option>
            <option value="price">Lowest price</option>
            <option value="experience">Most experience</option>
            <option value="name">Name</option>
          </select>
          <div
            role="group"
            aria-label="View"
            className="flex rounded-md border border-border"
          >
            {(["grid", "stack"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`px-3 py-2 text-sm ${view === v ? "bg-surface-raised font-semibold" : "text-muted"}`}
              >
                {v === "grid" ? "Grid" : "One at a time"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <details
        className="rounded-2xl border border-border bg-surface"
        open={count > 0}
      >
        <summary className="cursor-pointer select-none px-4 py-3 font-semibold">
          Filters
          {count > 0 && (
            <span className="ml-2 rounded-full bg-accent px-2 text-xs text-accent-foreground">
              {count}
            </span>
          )}
        </summary>
        <Filters filters={filters} onChange={setFilters} />
      </details>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <p className="text-sm text-muted" aria-live="polite">
        {shown.length} {shown.length === 1 ? "coach" : "coaches"}
      </p>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface p-6 text-center text-muted">
          {tab === "saved"
            ? "Save coaches you like to compare them later."
            : tab === "blocked"
              ? "You haven't blocked anyone."
              : tab === "passed"
                ? "Coaches you pass on show here, so you can change your mind."
                : count > 0
                  ? "No coaches match those filters. Try removing one."
                  : "No coaches yet."}
        </p>
      ) : view === "stack" && tab !== "blocked" ? (
        <Stack cards={shown} canSave={canSave} onFlag={flag} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((card) => (
            <li
              key={card.id}
              className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface"
            >
              <Link href={`/coaches/${card.id}`} tabIndex={-1} aria-hidden>
                <Portrait card={card} className="aspect-[4/3]" />
              </Link>
              <div className="flex flex-1 flex-col gap-3 p-4">
                <Facts card={card} />
                <label
                  className={`flex w-fit items-center gap-2 text-sm ${compare.length >= 3 && !compare.includes(card.id) ? "text-muted/60" : "text-muted"}`}
                >
                  <input
                    type="checkbox"
                    checked={compare.includes(card.id)}
                    disabled={compare.length >= 3 && !compare.includes(card.id)}
                    onChange={() => toggleCompare(card.id)}
                    className="accent-[var(--accent)]"
                  />
                  Compare
                </label>
                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                  <Link
                    href={`/coaches/${card.id}`}
                    className="btn-primary flex-1 px-3 py-2 text-sm"
                  >
                    View profile
                  </Link>
                  {card.joined && (
                    <Link
                      href={`/messages/${card.id}`}
                      className="btn-secondary px-3 py-2 text-sm"
                    >
                      Message
                    </Link>
                  )}
                  {card.blocked && (
                    <button
                      type="button"
                      onClick={() => unblock(card.id)}
                      className="btn-secondary px-3 py-2 text-sm"
                    >
                      Unblock
                    </button>
                  )}
                  {canSave && !card.blocked && (
                    <>
                      <button
                        type="button"
                        aria-pressed={card.saved}
                        aria-label={
                          card.saved
                            ? `Unsave ${card.name}`
                            : `Save ${card.name}`
                        }
                        onClick={() => flag(card.id, "saved", !card.saved)}
                        className={`btn-secondary px-3 py-2 text-sm ${card.saved ? "border-accent text-accent" : ""}`}
                      >
                        {card.saved ? "Saved" : "Save"}
                      </button>
                      <button
                        type="button"
                        aria-label={
                          card.passed
                            ? `Bring back ${card.name}`
                            : `Pass on ${card.name}`
                        }
                        onClick={() => flag(card.id, "passed", !card.passed)}
                        className="px-2 text-sm text-muted hover:text-foreground"
                      >
                        {card.passed ? "Undo pass" : "Pass"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {compare.length > 0 && (
        <div
          role="region"
          aria-label="Compare coaches"
          className="sticky bottom-3 z-20 mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-2xl border border-accent/60 bg-background/95 px-4 py-3 shadow-xl backdrop-blur"
        >
          <p className="min-w-0 flex-1 truncate text-sm">
            <span className="font-semibold">
              Compare {compare.length} of 3:
            </span>{" "}
            <span className="text-muted">
              {compare
                .map((id) => cards.find((c) => c.id === id)?.name)
                .filter(Boolean)
                .join(", ")}
            </span>
          </p>
          <button
            type="button"
            onClick={() => setCompare([])}
            className="text-sm text-muted hover:text-foreground"
          >
            Clear
          </button>
          {compare.length >= 2 ? (
            <Link
              href={`/coaches/compare?ids=${compare.join(",")}`}
              className="btn-primary px-4 py-2 text-sm"
            >
              Compare
            </Link>
          ) : (
            <span className="text-xs text-muted">Pick one more</span>
          )}
        </div>
      )}
    </div>
  );
}

// One card at a time, like a matchmaking app. Swiping is optional: buttons and the arrow keys do the
// same thing (left passes, right saves).
function Stack({
  cards,
  canSave,
  onFlag,
}: {
  cards: CoachCard[];
  canSave: boolean;
  onFlag: (id: string, kind: "saved" | "passed", on: boolean) => void;
}) {
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState(0);
  const startX = useRef<number | null>(null);
  const card = cards[Math.min(index, cards.length - 1)];
  const done = index >= cards.length;

  function next(action: "pass" | "save" | "skip") {
    if (!card) return;
    if (canSave && action === "pass") onFlag(card.id, "passed", true);
    if (canSave && action === "save") onFlag(card.id, "saved", true);
    setDrag(0);
    // A passed card leaves the list, so the next one slides into the same place.
    if (!(canSave && action === "pass")) setIndex((i) => i + 1);
  }

  if (done || !card)
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-center">
        <p className="font-semibold">That&apos;s everyone for now.</p>
        <button
          type="button"
          onClick={() => setIndex(0)}
          className="btn-secondary mt-3"
        >
          Start over
        </button>
      </div>
    );

  return (
    <div
      className="mx-auto max-w-sm space-y-4"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") next(canSave ? "pass" : "skip");
        if (e.key === "ArrowRight") next(canSave ? "save" : "skip");
      }}
    >
      <article
        tabIndex={0}
        aria-label={`${card.name}. ${index + 1} of ${cards.length}. ${canSave ? "Left arrow passes, right arrow saves." : ""}`}
        onPointerDown={(e) => {
          startX.current = e.clientX;
        }}
        onPointerMove={(e) => {
          if (startX.current !== null) setDrag(e.clientX - startX.current);
        }}
        onPointerUp={() => {
          startX.current = null;
          if (drag > 110) next(canSave ? "save" : "skip");
          else if (drag < -110) next(canSave ? "pass" : "skip");
          else setDrag(0);
        }}
        onPointerCancel={() => {
          startX.current = null;
          setDrag(0);
        }}
        style={{
          transform: `translateX(${drag}px) rotate(${drag / 30}deg)`,
          touchAction: "pan-y",
        }}
        className="overflow-hidden rounded-3xl border border-border bg-surface shadow-xl transition-transform duration-75 focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none"
      >
        <Portrait card={card} className="aspect-[4/5]" />
        <div className="p-5">
          <Facts card={card} />
        </div>
      </article>
      <p className="text-center text-xs text-muted">
        {index + 1} of {cards.length}
        {canSave && " · swipe, use the buttons or the arrow keys"}
      </p>
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => next(canSave ? "pass" : "skip")}
          className="btn-secondary size-14 rounded-full p-0"
          aria-label={canSave ? `Pass on ${card.name}` : "Next coach"}
        >
          ✕
        </button>
        <Link href={`/coaches/${card.id}`} className="btn-primary px-5">
          View profile
        </Link>
        <button
          type="button"
          onClick={() => next(canSave ? "save" : "skip")}
          className={`btn-secondary size-14 rounded-full border-accent p-0 ${card.saved ? "bg-accent text-accent-foreground" : "text-accent"}`}
          aria-label={
            canSave
              ? card.saved
                ? `${card.name} is saved. Next coach`
                : `Save ${card.name}`
              : "Next coach"
          }
        >
          ♥
        </button>
      </div>
    </div>
  );
}

function Filters({
  filters,
  onChange,
}: {
  filters: DiscoveryFilters;
  onChange: (f: DiscoveryFilters) => void;
}) {
  const set = (change: Partial<DiscoveryFilters>) =>
    onChange({ ...filters, ...change });
  return (
    <div className="space-y-4 border-t border-border p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Search</span>
          <input
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder="Name, specialty or city"
            className="field-input"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Location</span>
          <input
            value={filters.location}
            onChange={(e) => set({ location: e.target.value })}
            placeholder="Atlanta"
            className="field-input"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Training format</span>
          <select
            value={filters.format}
            onChange={(e) =>
              set({ format: e.target.value as DiscoveryFilters["format"] })
            }
            className="field-input"
          >
            <option value="any">Any</option>
            <option value="online">Online</option>
            <option value="in_person">In person</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Monthly price up to</span>
          <select
            value={filters.maxPrice ?? ""}
            onChange={(e) =>
              set({ maxPrice: e.target.value ? Number(e.target.value) : null })
            }
            className="field-input"
          >
            <option value="">Any price</option>
            <option value="7500">$75</option>
            <option value="15000">$150</option>
            <option value="25000">$250</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Experience</span>
          <select
            value={filters.minYears ?? ""}
            onChange={(e) =>
              set({ minYears: e.target.value ? Number(e.target.value) : null })
            }
            className="field-input"
          >
            <option value="">Any</option>
            <option value="2">2+ years</option>
            <option value="5">5+ years</option>
            <option value="10">10+ years</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Rating</span>
          <select
            value={filters.minRating ?? ""}
            onChange={(e) =>
              set({ minRating: e.target.value ? Number(e.target.value) : null })
            }
            className="field-input"
          >
            <option value="">Any</option>
            <option value="4">4+ stars</option>
            <option value="4.5">4.5+ stars</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Coaching style</span>
          <select
            value={filters.motivation ?? ""}
            onChange={(e) => set({ motivation: e.target.value || null })}
            className="field-input"
          >
            <option value="">Any</option>
            {COACH_STYLE.motivation.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Accountability</span>
          <select
            value={filters.accountability ?? ""}
            onChange={(e) => set({ accountability: e.target.value || null })}
            className="field-input"
          >
            <option value="">Any</option>
            {COACH_STYLE.accountability.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Language</span>
          <select
            value={filters.language}
            onChange={(e) =>
              set({ language: e.target.value as DiscoveryFilters["language"] })
            }
            className="field-input"
          >
            <option value="any">Any</option>
            <option value="spanish">Speaks Spanish</option>
          </select>
        </label>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Specialty or goal</legend>
        <div className="flex flex-wrap gap-2">
          {POPULATIONS.map((p) => {
            const on = filters.populations.includes(p);
            return (
              <button
                key={p}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  set({
                    populations: on
                      ? filters.populations.filter((x) => x !== p)
                      : [...filters.populations, p],
                  })
                }
                className={`rounded-full border px-3 py-1 text-sm ${on ? "border-accent bg-accent text-accent-foreground" : "border-border text-muted hover:text-foreground"}`}
              >
                {p}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {(
          [
            ["acceptingOnly", "Accepting new clients"],
            ["verifiedOnly", "Verified credentials"],
            ["accessibility", "Offers accessible training"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={filters[key]}
              onChange={(e) => set({ [key]: e.target.checked })}
              className="accent-[var(--accent)]"
            />
            {label}
          </label>
        ))}
      </div>
      {activeFilterCount(filters) > 0 && (
        <button
          type="button"
          onClick={() => onChange(NO_FILTERS)}
          className="text-sm text-accent hover:underline"
        >
          Clear all filters
        </button>
      )}
    </div>
  );
}
