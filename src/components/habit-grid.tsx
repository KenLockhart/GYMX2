"use client";

import { useOptimistic, useState, useTransition } from "react";
import { setHabitDone } from "@/app/(app)/track/actions";

type Habit = { id: string; name: string };

// A week of check-off boxes for a group of habits. Ticks show straight away and save in the background.
export function HabitGrid({
  habits,
  days,
  dayLabels,
  today,
  done,
}: {
  habits: Habit[];
  days: string[];
  dayLabels: string[];
  today: string;
  done: string[]; // "habitId:day" for every check-in shown
}) {
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [checked, toggleChecked] = useOptimistic(
    new Set(done),
    (current, key: string) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    },
  );

  function toggle(habitId: string, day: string) {
    const key = `${habitId}:${day}`;
    const isDone = !checked.has(key);
    setError(null);
    startTransition(async () => {
      toggleChecked(key);
      const result = await setHabitDone(habitId, day, isDone);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-1">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <thead>
            <tr>
              <th className="p-2 text-left font-medium text-muted">Habit</th>
              {days.map((day, index) => (
                <th
                  key={day}
                  className={`w-11 p-1 text-center text-xs font-medium ${day === today ? "text-accent" : "text-muted"}`}
                >
                  {day === today ? "Today" : dayLabels[index]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {habits.map((habit) => (
              <tr key={habit.id} className="border-t border-border">
                <th scope="row" className="p-2 text-left font-normal">
                  {habit.name}
                </th>
                {days.map((day, index) => {
                  const isChecked = checked.has(`${habit.id}:${day}`);
                  return (
                    <td key={day} className="p-1 text-center">
                      <button
                        type="button"
                        onClick={() => toggle(habit.id, day)}
                        aria-pressed={isChecked}
                        aria-label={`${habit.name}, ${day === today ? "today" : dayLabels[index]}: ${isChecked ? "done" : "not done"}`}
                        className={`inline-flex size-9 items-center justify-center rounded-md border text-base font-bold transition ${
                          isChecked
                            ? "border-accent bg-accent text-accent-foreground"
                            : "border-border hover:border-accent"
                        } ${day === today ? "ring-1 ring-accent/40" : ""}`}
                      >
                        {isChecked ? "✓" : ""}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
