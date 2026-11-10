"use client";

import { CalendarDays } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RANGES } from "@/lib/admin-console";

type Option = { value: string | number; label: string };

// A time range kept in the address (so it can be shared and survives a refresh). Other settings in
// the address, such as the open tab, stay as they are.
export function RangeSelect({
  value,
  options = RANGES.map((r) => ({ value: r.days, label: r.label })),
}: {
  value: string | number;
  options?: readonly Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <label className="relative flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm">
      <CalendarDays
        aria-hidden
        className="size-[18px] text-muted"
        strokeWidth={1.8}
      />
      <span className="sr-only">Time range</span>
      <select
        value={String(value)}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          next.set("range", e.target.value);
          router.push(`${pathname}?${next.toString()}`);
        }}
        className="cursor-pointer appearance-none bg-transparent pr-5 font-semibold outline-none"
      >
        {options.map((r) => (
          <option key={r.value} value={String(r.value)} className="bg-surface">
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
