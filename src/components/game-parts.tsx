"use client";

import { useT } from "@/i18n/client";
import type { Badge } from "@/lib/achievements";

const pillarStyle: Record<string, string> = {
  mind: "border-sky-400/60 text-sky-300",
  body: "border-accent/70 text-accent",
  spirit: "border-amber-400/60 text-amber-300",
};

export function PillarTag({ pillar }: { pillar: string | null | undefined }) {
  const t = useT();
  const label = pillar ? t.options.pillars[pillar] : null;
  if (!label || !pillar) return null;
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${pillarStyle[pillar]}`}
    >
      {label}
    </span>
  );
}

// A row of earned badges, shown next to a person's name. Hover or focus for the badge's name.
export function BadgeRow({
  badges,
  max = 6,
}: {
  badges: Badge[];
  max?: number;
}) {
  const t = useT();
  if (badges.length === 0) return null;
  const shown = badges.slice(0, max);
  const more = badges.length - shown.length;
  return (
    <ul
      className="flex flex-wrap items-center gap-1"
      aria-label={t.options.badgesLabel}
    >
      {shown.map((badge) => {
        const local = t.options.badges[badge.name];
        const name = local?.name ?? badge.name;
        return (
          <li
            key={badge.key}
            title={`${name}: ${local?.description ?? badge.description}`}
            className="flex size-7 items-center justify-center rounded-full border border-border bg-surface-raised text-sm"
          >
            <span aria-hidden="true">{badge.icon}</span>
            <span className="sr-only">{name}</span>
          </li>
        );
      })}
      {more > 0 && <li className="text-xs text-muted">+{more}</li>}
    </ul>
  );
}
