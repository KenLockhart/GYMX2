"use client";

import { CalendarDays } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { RANGES, type RangeDays } from "@/lib/admin-console";

// The overview's time range, kept in the address so it can be shared and survives a refresh.
export function RangeSelect({ value }: { value: RangeDays }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <label className="relative flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm">
      <CalendarDays
        aria-hidden
        className="size-[18px] text-muted"
        strokeWidth={1.8}
      />
      <span className="sr-only">Time range</span>
      <select
        value={value}
        onChange={(e) => router.push(`${pathname}?range=${e.target.value}`)}
        className="cursor-pointer appearance-none bg-transparent pr-5 font-semibold outline-none"
      >
        {RANGES.map((r) => (
          <option key={r.days} value={r.days} className="bg-surface">
            {r.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="pointer-events-none absolute right-3 size-4 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </label>
  );
}
