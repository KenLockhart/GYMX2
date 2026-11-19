"use client";

import {
  Archive,
  CalendarDays,
  CalendarPlus2,
  CheckCircle2,
  Clapperboard,
  FileText,
  Lightbulb,
  Quote,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DailyContentItemForm } from "@/components/daily-content/item-form";
import { DailyContentPublishForm } from "@/components/daily-content/publish-form";
import { DailyContentSlotCancelForm } from "@/components/daily-content/slot-cancel-form";
import { useActionState } from "react";
import {
  archiveDailyContentItem,
} from "@/app/(app)/daily-content/actions";
import type {
  DailyContentActionState,
  DailyContentKind,
  DailyContentPortalData,
  DailyContentPortalItem,
  DailyContentPortalSlot,
} from "@/lib/daily-content";
import type { Messages } from "@/i18n/messages";

type Copy = Messages["library"]["dailyContent"];

const idleState: DailyContentActionState = { status: "idle" };

function kindName(kind: DailyContentKind, copy: Copy) {
  if (kind === "video") return copy.kindVideoShort;
  if (kind === "quote") return copy.kindQuoteShort;
  return copy.kindAffirmationShort;
}

function KindIcon({ kind }: { kind: DailyContentKind }) {
  if (kind === "video") return <Clapperboard aria-hidden className="size-5" />;
  if (kind === "quote") return <Quote aria-hidden className="size-5" />;
  return <Lightbulb aria-hidden className="size-5" />;
}

function ItemStatus({ item, copy }: { item: DailyContentPortalItem; copy: Copy }) {
  const label =
    item.status === "draft"
      ? copy.statusDraft
      : item.status === "archived"
        ? copy.statusArchived
        : copy.statusActive;
  const tone = item.status === "active" ? "text-accent" : "text-muted";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-background/70 px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {item.status === "active" ? <CheckCircle2 aria-hidden className="size-3.5" /> : <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {label}
    </span>
  );
}

function SlotStatus({ slot, today, copy }: { slot: DailyContentPortalSlot; today: string; copy: Copy }) {
  const isLiveToday = slot.status === "scheduled" && slot.day === today;
  const label =
    isLiveToday
      ? copy.slotLiveToday
      : slot.status === "scheduled"
        ? copy.slotScheduled
        : slot.status === "published"
          ? copy.slotPublished
          : copy.slotCancelled;
  const tone = slot.status === "published" || isLiveToday ? "text-accent" : "text-muted";
  return <span className={`rounded-full border border-border px-2.5 py-1 text-xs font-semibold ${tone}`}>{label}</span>;
}

function ArchiveForm({ itemId, copy }: { itemId: string; copy: Copy }) {
  const [state, formAction, pending] = useActionState(archiveDailyContentItem, idleState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="item_id" value={itemId} />
      <button type="submit" className="btn-secondary min-h-10" disabled={pending}>
        <Archive aria-hidden className="mr-2 inline size-4" />
        {pending ? copy.archiving : copy.archiveItem}
      </button>
      {state.status === "archived" && <span role="status" className="text-sm text-success">{copy.archived}</span>}
      {state.status === "error" && <span role="alert" className="text-sm text-danger">{copy.errors[state.reason]}</span>}
    </form>
  );
}

function SlotCard({ slot, today, copy }: { slot: DailyContentPortalSlot; today: string; copy: Copy }) {
  return (
    <li className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 rounded-lg bg-accent/10 p-2 text-accent"><KindIcon kind={slot.kind} /></span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{slot.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <time dateTime={slot.day}>{slot.day}</time>
            <span aria-hidden>·</span>
            <span>{kindName(slot.kind, copy)}</span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:justify-end">
        <SlotStatus slot={slot} today={today} copy={copy} />
        {slot.status !== "cancelled" && <DailyContentSlotCancelForm slotId={slot.id} copy={copy} />}
      </div>
    </li>
  );
}

function ItemCard({
  item,
  data,
  copy,
  uploadHref,
}: {
  item: DailyContentPortalItem;
  data: DailyContentPortalData;
  copy: Copy;
  uploadHref: string;
}) {
  const [editing, setEditing] = useState(false);
  const icon = item.kind === "video" ? <Video aria-hidden className="size-4" /> : <FileText aria-hidden className="size-4" />;
  const latestRevisionKey = item.latestRevision?.id ?? "no-revision";

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="border-b border-border bg-surface-raised/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
              {icon}{kindName(item.kind, copy)}
            </span>
            <ItemStatus item={item} copy={copy} />
          </div>
          {item.status !== "archived" && (
            <button type="button" className="btn-secondary min-h-9 px-3" onClick={() => setEditing((value) => !value)}>
              {editing ? copy.closeEditor : copy.editItem}
            </button>
          )}
        </div>
        <h3 className="mt-4 text-xl font-semibold">{item.title}</h3>
        <p className="mt-1 text-xs text-muted">{copy.updated} <time dateTime={item.updatedAt}>{item.updatedAt.slice(0, 10)}</time></p>
        {item.latestRevision && (
          <div className="mt-4 rounded-xl border border-border/80 bg-background/70 p-3 text-sm">
            <p className="font-medium">{item.latestRevision.titleSnapshot}</p>
            {item.kind === "video" && (
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted">
                <span>{data.videoOptions.find((video) => video.id === item.latestRevision?.videoId)?.title ?? copy.videoSelected}</span>
                {item.latestRevision.videoId && (
                  <Link href={`/library/${item.latestRevision.videoId}`} className="font-semibold text-link hover:underline">{copy.viewVideo}</Link>
                )}
              </div>
            )}
            {item.kind === "quote" && (
              <blockquote className="mt-2 border-l-2 border-accent pl-3 text-muted">
                <p>“{item.latestRevision.quoteText}”</p>
                {item.latestRevision.quoteAttribution && <footer className="mt-1 text-xs">{item.latestRevision.quoteAttribution}</footer>}
              </blockquote>
            )}
            {item.kind === "affirmation" && <p className="mt-2 text-muted">{item.latestRevision.affirmationText}</p>}
            <p className="mt-3 text-xs text-muted">{copy.revisionLabel} {item.latestRevision.number}</p>
          </div>
        )}
      </div>

      <div className="space-y-4 p-5">
        {editing && item.status !== "archived" && (
          <DailyContentItemForm
            key={`${item.id}-${latestRevisionKey}`}
            item={item}
            videoOptions={data.videoOptions}
            copy={copy}
            uploadHref={uploadHref}
          />
        )}
        {item.status !== "archived" ? (
          <DailyContentPublishForm
            item={item}
            today={data.today}
            copy={copy}
          />
        ) : null}
        {item.status !== "archived" && <ArchiveForm itemId={item.id} copy={copy} />}
      </div>
    </article>
  );
}

export function DailyContentManager({
  data,
  copy,
  uploadHref,
}: {
  data: DailyContentPortalData;
  copy: Copy;
  uploadHref: string;
}) {
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  const allSlots = [...data.slots].sort((a, b) => a.day.localeCompare(b.day));
  const draftCount = data.items.filter((item) => item.status === "draft").length;
  const activeCount = data.items.filter((item) => item.status === "active").length;
  const managerPath = data.role === "coach" ? "/library/daily-content" : "/admin/daily-content";
  const hasNextPage = data.hasMoreItems || data.hasMoreVideos;

  return (
    <div className="space-y-8">
      <header className="relative overflow-hidden rounded-3xl border border-border bg-surface p-6 sm:p-8 lg:p-10">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-24 size-72 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent">{copy.eyebrow}</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{copy.title}</h1>
            <p className="mt-3 max-w-xl text-muted">{data.role === "coach" ? copy.coachIntro : copy.adminIntro}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border bg-background px-4 text-sm font-semibold">
              <CalendarDays aria-hidden className="size-4 text-accent" />
              {copy.today}: {data.today}
            </span>
            <button type="button" className="btn-primary min-h-10" onClick={() => setCreating((value) => !value)}>
              <CalendarPlus2 aria-hidden className="mr-2 inline size-4" />
              {creating ? copy.closeEditor : copy.newItem}
            </button>
          </div>
        </div>
        <div className="relative mt-6 flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full border border-border bg-background/70 px-3 py-1.5">{activeCount} {copy.activeCount}</span>
          <span className="rounded-full border border-border bg-background/70 px-3 py-1.5">{draftCount} {copy.draftCount}</span>
          <span className="rounded-full border border-border bg-background/70 px-3 py-1.5">{data.slots.filter((slot) => slot.status === "scheduled").length} {copy.scheduledCount}</span>
        </div>
      </header>

      <aside className="rounded-2xl border border-accent/25 bg-accent/5 p-5">
        <h2 className="font-semibold">{copy.priorityHeading}</h2>
        <p className="mt-1 text-sm leading-6 text-muted">{copy.priorityBody}</p>
      </aside>

      {data.error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          <span>{copy.loadError}</span>
          <button type="button" onClick={() => router.refresh()} className="font-semibold underline underline-offset-2">{copy.retry}</button>
        </div>
      )}

      {data.truncated && (
        <p role="status" className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">{copy.limitedListWarning}</p>
      )}

      {creating && (
        <section className="rounded-2xl border border-accent/30 bg-surface p-5 shadow-sm sm:p-6">
          <div className="mb-4">
            <p className="text-xs font-bold uppercase tracking-widest text-accent">{copy.newItem}</p>
            <h2 className="mt-1 text-2xl font-semibold">{copy.createHeading}</h2>
          </div>
          <DailyContentItemForm videoOptions={data.videoOptions} copy={copy} uploadHref={uploadHref} />
        </section>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold">{copy.itemsHeading}</h2>
            <p className="mt-1 text-sm text-muted">{copy.itemsDescription}</p>
          </div>
          <Link href="/library" className="inline-flex items-center gap-2 text-sm font-semibold text-link hover:underline">
            <Video aria-hidden className="size-4" />{copy.libraryLink}
          </Link>
        </div>
        {!data.error && data.items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent/10 text-accent"><Lightbulb aria-hidden className="size-6" /></span>
            <h3 className="mt-4 text-xl font-semibold">{copy.emptyHeading}</h3>
            <p className="mx-auto mt-2 max-w-lg text-sm text-muted">{copy.emptyDescription}</p>
            <button type="button" className="btn-primary mt-5 min-h-10" onClick={() => setCreating(true)}>{copy.createItem}</button>
          </div>
        ) : data.items.length > 0 ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {data.items.map((item) => (
              <ItemCard key={item.id} item={item} data={data} copy={copy} uploadHref={uploadHref} />
            ))}
          </div>
        ) : null}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold">{copy.scheduleListHeading}</h2>
          <p className="mt-1 text-sm text-muted">{copy.scheduleListDescription}</p>
        </div>
        {allSlots.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-5 text-sm text-muted">{copy.scheduleEmpty}</div>
        ) : (
          <ul className="space-y-3">
            {allSlots.map((slot) => <SlotCard key={slot.id} slot={slot} today={data.today} copy={copy} />)}
          </ul>
        )}
      </section>

      {(data.page > 1 || hasNextPage) && (
        <nav aria-label={copy.paginationLabel} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
          {data.page > 1 ? (
            <Link href={`${managerPath}?page=${data.page - 1}`} className="btn-secondary min-h-10">{copy.previousPage}</Link>
          ) : <span />}
          <span className="text-sm text-muted">{copy.pageLabel} {data.page}</span>
          {hasNextPage ? (
            <Link href={`${managerPath}?page=${data.page + 1}`} className="btn-secondary min-h-10">{copy.nextPage}</Link>
          ) : <span />}
        </nav>
      )}
    </div>
  );
}
