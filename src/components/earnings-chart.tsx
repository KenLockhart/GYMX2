"use client";

import { useState } from "react";

type Month = { key: string; label: string; cents: number };

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 20, right: 12, bottom: 28, left: 52 };

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 ? 2 : 0,
  });

function niceMax(value: number) {
  if (value <= 0) return 10000;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step =
    [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m * magnitude >= value) ??
    10;
  return step * magnitude;
}

// Net earnings per month: one series, so the caption names it and no legend is needed.
export function EarningsChart({ months }: { months: Month[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(...months.map((month) => month.cents)));
  const innerWidth = WIDTH - PAD.left - PAD.right;
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const slot = innerWidth / months.length;
  const barWidth = Math.min(48, slot * 0.6);
  const y = (cents: number) => PAD.top + (1 - cents / max) * innerHeight;
  const ticks = [0, max / 2, max];
  const shown = active === null ? months.length - 1 : active;

  return (
    <figure className="space-y-2">
      <figcaption className="flex items-baseline justify-between text-sm">
        <span className="font-medium">Your earnings by month, after fees</span>
        <span className="tabular-nums text-muted" aria-live="polite">
          {months[shown].label}: {money(months[shown].cents)}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full select-none"
        role="img"
        aria-label={months
          .map((month) => `${month.label} ${money(month.cents)}`)
          .join(", ")}
        onPointerLeave={() => setActive(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--color-border)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={y(tick)}
              dy="0.32em"
              textAnchor="end"
              fontSize={11}
              fill="var(--color-muted)"
            >
              {money(tick)}
            </text>
          </g>
        ))}
        {months.map((month, index) => {
          const center = PAD.left + slot * index + slot / 2;
          const top = y(month.cents);
          const height = Math.max(0, PAD.top + innerHeight - top);
          const radius = Math.min(4, height / 2, barWidth / 2);
          const left = center - barWidth / 2;
          const bottom = PAD.top + innerHeight;
          return (
            <g
              key={month.key}
              onPointerEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
            >
              {/* A tall invisible target makes small bars easy to hover. */}
              <rect
                x={center - slot / 2}
                y={PAD.top}
                width={slot}
                height={innerHeight}
                fill="transparent"
              />
              {height > 0 && (
                <path
                  d={`M${left},${bottom} V${top + radius} Q${left},${top} ${left + radius},${top} H${left + barWidth - radius} Q${left + barWidth},${top} ${left + barWidth},${top + radius} V${bottom} Z`}
                  fill="var(--color-accent)"
                  opacity={active === null || active === index ? 1 : 0.45}
                />
              )}
              <text
                x={center}
                y={HEIGHT - 8}
                textAnchor="middle"
                fontSize={11}
                fill={
                  index === shown
                    ? "var(--color-foreground)"
                    : "var(--color-muted)"
                }
              >
                {month.label}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
