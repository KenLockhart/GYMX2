"use client";

import { useState } from "react";
import { useLocale, useT } from "@/i18n/client";
import { LOCALE_TAG, type Locale } from "@/i18n/config";

type Point = { day: string; value: number };

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 44 };

function formatDay(day: string, locale: Locale) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(LOCALE_TAG[locale], {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// One line of weigh-ins over time, with a crosshair and the value under the pointer.
// A single series, so the title names it and no legend is needed. Dates are spaced by real time.
export function WeightChart({ points }: { points: Point[] }) {
  const [active, setActive] = useState<number | null>(null);
  const locale = useLocale();
  const t = useT().track.chart;
  const shortDate = (day: string) => formatDay(day, locale);
  const weightTitle = useT().track.weight;
  if (points.length < 2) return null;

  const times = points.map((point) =>
    new Date(`${point.day}T12:00:00Z`).getTime(),
  );
  const minTime = times[0];
  const maxTime = times[times.length - 1];
  const values = points.map((point) => point.value);
  const low = Math.floor(Math.min(...values) - 2);
  const high = Math.ceil(Math.max(...values) + 2);
  const innerWidth = WIDTH - PAD.left - PAD.right;
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (time: number) =>
    PAD.left + ((time - minTime) / Math.max(1, maxTime - minTime)) * innerWidth;
  const y = (value: number) =>
    PAD.top + (1 - (value - low) / Math.max(1, high - low)) * innerHeight;
  const ticks = [low, Math.round((low + high) / 2), high];
  const path = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${x(times[index])},${y(point.value)}`,
    )
    .join(" ");

  function nearest(clientX: number, rect: DOMRect) {
    const svgX = ((clientX - rect.left) / rect.width) * WIDTH;
    let best = 0;
    for (let index = 1; index < points.length; index += 1) {
      if (Math.abs(x(times[index]) - svgX) < Math.abs(x(times[best]) - svgX))
        best = index;
    }
    return best;
  }

  const shown = active === null ? null : points[active];

  return (
    <figure className="space-y-2">
      <figcaption className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{weightTitle}</span>
        <span className="tabular-nums text-muted" aria-live="polite">
          {shown
            ? `${shortDate(shown.day)}: ${shown.value} lb`
            : t.range(
                shortDate(points[0].day),
                shortDate(points[points.length - 1].day),
              )}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full touch-none select-none"
        role="img"
        aria-label={t.label(
          points[0].value,
          shortDate(points[0].day),
          points[points.length - 1].value,
          shortDate(points[points.length - 1].day),
        )}
        onPointerMove={(event) =>
          setActive(
            nearest(event.clientX, event.currentTarget.getBoundingClientRect()),
          )
        }
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
              {tick}
            </text>
          </g>
        ))}
        <text
          x={PAD.left}
          y={HEIGHT - 8}
          fontSize={11}
          fill="var(--color-muted)"
        >
          {shortDate(points[0].day)}
        </text>
        <text
          x={WIDTH - PAD.right}
          y={HEIGHT - 8}
          textAnchor="end"
          fontSize={11}
          fill="var(--color-muted)"
        >
          {shortDate(points[points.length - 1].day)}
        </text>
        <path
          d={path}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {active !== null && (
          <line
            x1={x(times[active])}
            x2={x(times[active])}
            y1={PAD.top}
            y2={HEIGHT - PAD.bottom}
            stroke="var(--color-muted)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
        {points.map((point, index) => (
          <circle
            key={point.day}
            cx={x(times[index])}
            cy={y(point.value)}
            r={active === index ? 6 : 4}
            fill="var(--color-accent)"
            stroke="var(--color-surface)"
            strokeWidth={2}
          />
        ))}
      </svg>
    </figure>
  );
}
