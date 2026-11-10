// Small building blocks for the coach profile. Server components: no browser code needed.
import type { ReactNode } from "react";
import type { CredentialStatus } from "@/lib/coach-profile";

export function SampleTag({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-dashed border-muted px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted ${className}`}
    >
      Sample
    </span>
  );
}

const STATUS = {
  verified: {
    label: "Credentials verified",
    tone: "text-success",
    icon: <path d="M9 12.5l2 2 4-4.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />,
  },
  pending: {
    label: "Verification pending",
    tone: "text-muted",
    icon: <path d="M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />,
  },
  unverified: {
    label: "Not verified",
    tone: "text-muted",
    icon: <path d="M12 8v5M12 16.5v.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />,
  },
  expired: {
    label: "Credentials expired",
    tone: "text-muted",
    icon: <path d="M12 8v5M12 16.5v.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />,
  },
} satisfies Record<
  CredentialStatus,
  { label: string; tone: string; icon: ReactNode }
>;

// The verified indicator. On the sample profile it can never pass for a real verification: it
// says "Sample" and uses a dashed outline.
export function VerificationBadge({
  status,
  sample,
  compact = false,
}: {
  status: CredentialStatus;
  sample: boolean;
  compact?: boolean;
}) {
  const meta = STATUS[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${compact ? "text-xs" : "text-sm"} ${
        sample
          ? "rounded-full border border-dashed border-border px-2 py-0.5 text-muted"
          : meta.tone
      }`}
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4 shrink-0"
      >
        {meta.icon}
      </svg>
      {sample ? `Sample: ${meta.label.toLowerCase()}` : meta.label}
    </span>
  );
}

export function Stars({ value, label }: { value: number; label: string }) {
  return (
    <span role="img" aria-label={label} className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          aria-hidden
          viewBox="0 0 24 24"
          className={`size-4 ${value >= n - 0.25 ? "fill-accent text-accent" : "fill-transparent text-muted"}`}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        >
          <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />
        </svg>
      ))}
    </span>
  );
}

// A placeholder portrait: no real person's photo is used until an approved one is uploaded.
export function PortraitPlaceholder({ name }: { name: string }) {
  const initial = name
    .replace(/^Coach\s+/i, "")
    .charAt(0)
    .toUpperCase();
  return (
    <div
      role="img"
      aria-label={`${name}: portrait coming soon`}
      className="relative flex size-full items-end overflow-hidden bg-surface-raised [container-type:inline-size]"
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 80% 10%, rgba(200,241,53,0.28), transparent 60%), radial-gradient(90% 70% at 0% 100%, rgba(200,241,53,0.12), transparent 70%), linear-gradient(160deg, #20241d 0%, #0d0f0c 100%)",
        }}
      />
      <svg
        aria-hidden
        viewBox="0 0 200 250"
        className="absolute inset-x-0 bottom-0 h-3/4 w-full text-accent/15"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
      >
        <circle cx="100" cy="70" r="34" />
        <path d="M30 250c4-62 32-100 70-100s66 38 70 100" />
      </svg>
      <span
        aria-hidden
        className="absolute right-[8%] top-[2%] font-display text-[clamp(3rem,30cqw,7rem)] font-bold leading-none text-accent/80"
      >
        {initial}
      </span>
      <span className="relative m-2 hidden rounded-full bg-background/80 px-3 py-1 text-xs text-muted backdrop-blur @[10rem]:inline sm:m-3">
        Portrait coming soon
      </span>
    </div>
  );
}

export function SummaryCard({
  value,
  label,
  sample,
}: {
  value: string;
  label: string;
  sample?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-2 py-4 text-center sm:px-4">
      <p className="font-display text-2xl font-bold leading-tight sm:text-3xl">
        {value}
      </p>
      <p className="mt-1 text-xs text-muted sm:text-sm">
        {label}
        {sample && <span className="sr-only"> (sample)</span>}
      </p>
    </div>
  );
}

export function Section({
  id,
  title,
  children,
  sample,
}: {
  id: string;
  title: string;
  children: ReactNode;
  sample?: boolean;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-20 space-y-4"
    >
      <h2
        id={`${id}-title`}
        className="flex flex-wrap items-center gap-2 text-3xl"
      >
        {title}
        {sample && <SampleTag />}
      </h2>
      {children}
    </section>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-border bg-surface p-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function DetailList({
  items,
}: {
  items: { label: string; value: string }[];
}) {
  return (
    <dl className="divide-y divide-border">
      {items.map((item) => (
        <div
          key={item.label}
          className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[12rem_1fr] sm:gap-4"
        >
          <dt className="text-sm text-muted">{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Chips({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li
          key={item}
          className="rounded-full border border-border bg-surface-raised px-3 py-1 text-sm"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

export function CheckList({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 size-4 shrink-0 text-accent"
          >
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

// A horizontal bar for a 0 to 100 score.
export function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="font-semibold tabular-nums">{value}%</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-raised"
      >
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}
