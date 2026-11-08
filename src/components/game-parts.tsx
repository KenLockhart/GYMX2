import { pillarLabel } from "@/lib/achievements";
import type { Badge } from "@/lib/achievements";

const pillarStyle: Record<string, string> = {
  mind: "border-sky-400/60 text-sky-300",
  body: "border-accent/70 text-accent",
  spirit: "border-amber-400/60 text-amber-300",
};

export function PillarTag({ pillar }: { pillar: string | null | undefined }) {
  const label = pillarLabel(pillar);
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
  if (badges.length === 0) return null;
  const shown = badges.slice(0, max);
  const more = badges.length - shown.length;
  return (
    <ul className="flex flex-wrap items-center gap-1" aria-label="Badges">
      {shown.map((badge) => (
        <li
          key={badge.key}
          title={`${badge.name}: ${badge.description}`}
          className="flex size-7 items-center justify-center rounded-full border border-border bg-surface-raised text-sm"
        >
          <span aria-hidden="true">{badge.icon}</span>
          <span className="sr-only">{badge.name}</span>
        </li>
      ))}
      {more > 0 && <li className="text-xs text-muted">+{more}</li>}
    </ul>
  );
}
