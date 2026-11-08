import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  ActionForm,
  Field,
  FormStatus,
  SubmitButton,
} from "@/components/form-parts";
import { PillarTag } from "@/components/game-parts";
import { HabitGrid } from "@/components/habit-grid";
import { PhotoGallery } from "@/components/photo-gallery";
import { PhotoUpload } from "@/components/photo-upload";
import { WeightChart } from "@/components/weight-chart";
import { loadProgressPhotos } from "@/lib/photos";
import { PILLARS, type Pillar } from "@/lib/achievements";
import { requireAccount } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  HABIT_SUGGESTIONS,
  MAX_HABITS,
  lastDays,
  nutritionAverages,
  pillarSummary,
  weekdayLabel,
  weightChange,
} from "@/lib/tracking";
import {
  addHabit,
  deleteProgressPhoto,
  removeHabit,
  saveBodyLog,
  saveNutritionLog,
  saveTrackingSettings,
} from "./actions";

export const metadata: Metadata = { title: "Track" };

type Habit = { id: string; name: string; pillar: Pillar };
type BodyLog = {
  day: string;
  weight_lb: string | null;
  body_fat_pct: string | null;
  waist_in: string | null;
};
type NutritionLog = {
  day: string;
  protein_g: number | null;
  calories: number | null;
  water_glasses: number | null;
  notes: string;
};

function shortDate(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function TrackPage() {
  const { profile } = await requireAccount();
  if (profile.role === "admin") redirect("/admin");

  const week = lastDays(7);
  const today = week[week.length - 1];
  const ninetyDaysAgo = lastDays(90)[0];
  const thirtyDaysAgo = lastDays(30)[0];

  const supabase = await createClient();
  const [
    { data: habitData },
    { data: logData },
    { data: bodyData },
    { data: nutritionData },
  ] = await Promise.all([
    supabase
      .from("habits")
      .select("id, name, pillar")
      .eq("user_id", profile.id)
      .eq("active", true)
      .order("created_at"),
    supabase
      .from("habit_logs")
      .select("habit_id, day")
      .eq("user_id", profile.id)
      .gte("day", week[0]),
    supabase
      .from("body_logs")
      .select("day, weight_lb, body_fat_pct, waist_in")
      .eq("user_id", profile.id)
      .gte("day", ninetyDaysAgo)
      .order("day"),
    supabase
      .from("nutrition_logs")
      .select("day, protein_g, calories, water_glasses, notes")
      .eq("user_id", profile.id)
      .gte("day", week[0]),
  ]);
  const habits = (habitData ?? []) as Habit[];
  const logs = (logData ?? []) as { habit_id: string; day: string }[];
  const bodyLogs = (bodyData ?? []) as BodyLog[];
  const nutritionLogs = (nutritionData ?? []) as NutritionLog[];

  const summary = pillarSummary(habits, logs, week);
  const todayDone = logs.filter((log) => log.day === today).length;
  const todayBody = bodyLogs.find((log) => log.day === today);
  const todayFood = nutritionLogs.find((log) => log.day === today);
  const weights = bodyLogs.flatMap((log) =>
    log.weight_lb === null
      ? []
      : [{ day: log.day, value: Number(log.weight_lb) }],
  );
  const change = weightChange(bodyLogs, thirtyDaysAgo);
  const averages = nutritionAverages(nutritionLogs, week);
  const names = new Set(habits.map((habit) => habit.name.toLowerCase()));
  const dayLabels = week.map(weekdayLabel);
  const photos = await loadProgressPhotos(profile.id);

  return (
    <div className="space-y-12">
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">
          Mind <span aria-hidden="true">•</span> Body{" "}
          <span aria-hidden="true">•</span> Spirit
        </p>
        <h1 className="mt-1 text-5xl">Track</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Daily habits, your body and what you eat, in one place.{" "}
          {profile.share_tracking
            ? "Your coaches can see this."
            : "Only you can see this unless you share it below."}
        </p>
      </div>

      {/* Habits */}
      <section className="space-y-5" aria-labelledby="habits">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="habits" className="text-3xl">
              Daily habits
            </h2>
            <p className="text-sm text-muted">
              Tick off what you did. Each one is +1 point and keeps your streak
              going. You can fix the last 7 days.
            </p>
          </div>
          {habits.length > 0 && (
            <p className="text-sm">
              Today: <span className="font-semibold">{todayDone}</span> of{" "}
              {habits.length}
            </p>
          )}
        </div>

        {habits.length > 0 && (
          <dl className="grid max-w-2xl grid-cols-3 gap-3">
            {PILLARS.map((pillar) => {
              const row = summary[pillar.value];
              const percent = row.possible
                ? Math.round((row.done / row.possible) * 100)
                : 0;
              return (
                <div
                  key={pillar.value}
                  className="rounded-lg border border-border bg-surface p-3"
                >
                  <dt className="text-sm text-muted">
                    {pillar.label} this week
                  </dt>
                  <dd className="text-2xl font-semibold">
                    {row.possible ? `${percent}%` : "–"}
                  </dd>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-raised">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </dl>
        )}

        {PILLARS.map((pillar) => {
          const group = habits.filter((habit) => habit.pillar === pillar.value);
          const suggestions = HABIT_SUGGESTIONS[pillar.value].filter(
            (name) => !names.has(name.toLowerCase()),
          );
          return (
            <div
              key={pillar.value}
              className="space-y-3 rounded-lg border border-border bg-surface p-4"
            >
              <h3 className="flex items-center gap-2 text-xl">
                <PillarTag pillar={pillar.value} /> {pillar.label}
              </h3>
              {group.length > 0 ? (
                <HabitGrid
                  habits={group}
                  days={week}
                  dayLabels={dayLabels}
                  today={today}
                  done={logs.map((log) => `${log.habit_id}:${log.day}`)}
                />
              ) : (
                <p className="text-sm text-muted">
                  No {pillar.label} habits yet. Add one below.
                </p>
              )}
              {habits.length < MAX_HABITS && suggestions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((name) => (
                    <ActionForm key={name} action={addHabit}>
                      <input type="hidden" name="name" value={name} />
                      <input type="hidden" name="pillar" value={pillar.value} />
                      <SubmitButton
                        pendingText="Adding..."
                        className="rounded-full border border-dashed border-border px-3 py-1 text-sm hover:border-accent"
                      >
                        + {name}
                      </SubmitButton>
                    </ActionForm>
                  ))}
                </div>
              )}
              {group.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted">
                    Remove a habit
                  </summary>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {group.map((habit) => (
                      <li key={habit.id}>
                        <ActionForm
                          action={removeHabit}
                          confirmMessage={`Remove "${habit.name}"? Past check-ins still count.`}
                        >
                          <input
                            type="hidden"
                            name="habit_id"
                            value={habit.id}
                          />
                          <SubmitButton
                            pendingText="Removing..."
                            className="rounded-full border border-border px-3 py-1 text-sm hover:border-danger"
                          >
                            × {habit.name}
                          </SubmitButton>
                        </ActionForm>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          );
        })}

        {habits.length < MAX_HABITS ? (
          <ActionForm
            action={addHabit}
            className="flex max-w-2xl flex-wrap items-end gap-3"
          >
            <Field
              label="Your own habit"
              name="name"
              maxLength={60}
              placeholder="Cold shower"
              required
              className="field-input w-64"
            />
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Pillar</span>
              <select
                name="pillar"
                required
                defaultValue=""
                className="field-input"
              >
                <option value="" disabled>
                  Choose
                </option>
                {PILLARS.map((pillar) => (
                  <option key={pillar.value} value={pillar.value}>
                    {pillar.label}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton pendingText="Adding..." className="btn-secondary">
              Add habit
            </SubmitButton>
            <div className="w-full">
              <FormStatus />
            </div>
          </ActionForm>
        ) : (
          <p className="text-sm text-muted">
            You&apos;re tracking {MAX_HABITS} habits, the most at once. Remove
            one to add another.
          </p>
        )}
      </section>

      {/* Body */}
      <section className="space-y-5" aria-labelledby="body">
        <div>
          <h2 id="body" className="text-3xl">
            Body
          </h2>
          <p className="text-sm text-muted">
            Log as often as you like; weekly is plenty. Progress is more than a
            number, so use what helps you.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
          <ActionForm
            action={saveBodyLog}
            className="space-y-3 rounded-lg border border-border bg-surface p-4"
          >
            <p className="font-semibold">Today, {shortDate(today)}</p>
            <input type="hidden" name="day" value={today} />
            <Field
              label="Weight (lb)"
              name="weight_lb"
              inputMode="decimal"
              defaultValue={todayBody?.weight_lb ?? ""}
            />
            <Field
              label="Body fat (%)"
              name="body_fat_pct"
              inputMode="decimal"
              defaultValue={todayBody?.body_fat_pct ?? ""}
            />
            <Field
              label="Waist (in)"
              name="waist_in"
              inputMode="decimal"
              defaultValue={todayBody?.waist_in ?? ""}
            />
            <div className="flex items-center gap-3">
              <SubmitButton pendingText="Saving..." className="btn-primary">
                Save
              </SubmitButton>
              <FormStatus />
            </div>
          </ActionForm>
          <div className="space-y-4">
            {weights.length >= 2 ? (
              <div className="rounded-lg border border-border bg-surface p-4">
                <WeightChart points={weights} />
                {change !== null && (
                  <p className="mt-2 text-sm text-muted">
                    Last 30 days:{" "}
                    {change === 0
                      ? "no change"
                      : `${change > 0 ? "+" : ""}${change} lb`}
                  </p>
                )}
              </div>
            ) : (
              <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
                Log your weight on two different days to see your trend here.
              </p>
            )}
            {bodyLogs.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Recent body measurements
                  </caption>
                  <thead className="bg-surface text-muted">
                    <tr>
                      <th className="p-2 text-left font-medium">Date</th>
                      <th className="p-2 text-right font-medium">Weight</th>
                      <th className="p-2 text-right font-medium">Body fat</th>
                      <th className="p-2 text-right font-medium">Waist</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {bodyLogs
                      .slice(-8)
                      .reverse()
                      .map((log) => (
                        <tr key={log.day}>
                          <td className="p-2">{shortDate(log.day)}</td>
                          <td className="p-2 text-right tabular-nums">
                            {log.weight_lb ? `${log.weight_lb} lb` : "–"}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {log.body_fat_pct ? `${log.body_fat_pct}%` : "–"}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {log.waist_in ? `${log.waist_in} in` : "–"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Progress photos */}
      <section className="space-y-4" aria-labelledby="photos">
        <div>
          <h2 id="photos" className="text-3xl">
            Progress photos
          </h2>
          <p className="text-sm text-muted">
            Private by default. Same pose, same light, every few weeks shows change the scale can&apos;t.
            {profile.share_tracking ? " Your coaches can see these." : ""}
          </p>
        </div>
        <PhotoUpload today={today} />
        {photos.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
            No photos yet. Add a front photo to start; after your second, you&apos;ll see first and latest side by
            side.
          </p>
        ) : (
          <PhotoGallery
            photos={photos}
            renderDelete={(photo) => (
              <ActionForm action={deleteProgressPhoto} confirmMessage="Delete this photo for good?">
                <input type="hidden" name="photo_id" value={photo.id} />
                <SubmitButton pendingText="Deleting..." className="text-xs text-muted hover:text-danger">
                  Delete
                </SubmitButton>
              </ActionForm>
            )}
          />
        )}
      </section>

      {/* Nutrition */}
      <section className="space-y-5" aria-labelledby="nutrition">
        <div>
          <h2 id="nutrition" className="text-3xl">
            Nutrition
          </h2>
          <p className="text-sm text-muted">
            A quick daily log. Fill in what you track and skip the rest.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
          <ActionForm
            action={saveNutritionLog}
            className="space-y-3 rounded-lg border border-border bg-surface p-4"
          >
            <p className="font-semibold">Today, {shortDate(today)}</p>
            <input type="hidden" name="day" value={today} />
            <Field
              label="Protein (g)"
              name="protein_g"
              inputMode="numeric"
              defaultValue={todayFood?.protein_g ?? ""}
            />
            <Field
              label="Calories"
              name="calories"
              inputMode="numeric"
              defaultValue={todayFood?.calories ?? ""}
            />
            <Field
              label="Glasses of water"
              name="water_glasses"
              inputMode="numeric"
              defaultValue={todayFood?.water_glasses ?? ""}
            />
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Notes (optional)</span>
              <textarea
                name="notes"
                rows={2}
                maxLength={500}
                defaultValue={todayFood?.notes ?? ""}
                placeholder="Meal prep went well; skipped the late snack."
                className="field-input"
              />
            </label>
            <div className="flex items-center gap-3">
              <SubmitButton pendingText="Saving..." className="btn-primary">
                Save
              </SubmitButton>
              <FormStatus />
            </div>
          </ActionForm>
          <div className="space-y-3">
            <dl className="grid grid-cols-3 gap-3">
              {[
                ["Protein", averages.protein, "g", profile.protein_target_g],
                ["Calories", averages.calories, "", profile.calorie_target],
                ["Water", averages.water, " glasses", null],
              ].map(([label, value, unit, target]) => (
                <div
                  key={label as string}
                  className="rounded-lg border border-border bg-surface p-3"
                >
                  <dt className="text-sm text-muted">
                    {label as string}, 7-day average
                  </dt>
                  <dd className="text-2xl font-semibold tabular-nums">
                    {value === null
                      ? "–"
                      : `${(value as number).toLocaleString("en-US")}${unit as string}`}
                  </dd>
                  {target !== null && target !== undefined && (
                    <p className="text-xs text-muted">
                      Target: {(target as number).toLocaleString("en-US")}
                      {unit as string}
                    </p>
                  )}
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted">
              Logged {averages.logged} of the last 7 days. Your coach can share
              meal plans in the Armory.
            </p>
          </div>
        </div>
      </section>

      {/* Settings */}
      <section
        className="max-w-2xl space-y-3"
        aria-labelledby="tracking-settings"
      >
        <h2 id="tracking-settings" className="text-2xl">
          Targets and sharing
        </h2>
        <ActionForm action={saveTrackingSettings} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Daily protein target (g)"
              name="protein_target_g"
              inputMode="numeric"
              defaultValue={profile.protein_target_g ?? ""}
            />
            <Field
              label="Daily calorie target"
              name="calorie_target"
              inputMode="numeric"
              defaultValue={profile.calorie_target ?? ""}
              hint="Optional. Your coach can help you set these."
            />
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="share_tracking"
              defaultChecked={profile.share_tracking}
              className="mt-0.5 size-4 accent-accent"
            />
            <span>
              Share my tracking with my coaches
              <span className="block text-muted">
                Coaches you&apos;ve joined see your habits, body measurements
                and nutrition log. GYMX2 admins never do.
              </span>
            </span>
          </label>
          <div className="flex items-center gap-3">
            <SubmitButton pendingText="Saving..." className="btn-secondary">
              Save
            </SubmitButton>
            <FormStatus />
          </div>
        </ActionForm>
      </section>
    </div>
  );
}
