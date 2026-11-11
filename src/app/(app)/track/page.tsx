import type { Metadata } from "next";
import Link from "next/link";
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
import { LOCALE_TAG, type Locale } from "@/i18n/config";
import { getLocale, getT } from "@/i18n/server";
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

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).track.title };
}

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

function formatDay(day: string, locale: Locale) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(LOCALE_TAG[locale], {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function TrackPage() {
  const { profile } = await requireAccount();
  if (profile.role === "admin") redirect("/admin");
  const all = await getT();
  const t = all.track;
  const locale = await getLocale();
  const tag = LOCALE_TAG[locale];
  const shortDate = (day: string) => formatDay(day, locale);
  const pillarName = (value: string) => all.options.pillars[value] ?? value;
  const suggestion = (name: string) => t.suggestions[name] ?? name;

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
  const dayLabels = week.map((day) => weekdayLabel(day, locale));
  const photos = await loadProgressPhotos(profile.id);

  return (
    <div className="space-y-12">
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">
          {t.mindBodySpirit[0]} <span aria-hidden="true">•</span>{" "}
          {t.mindBodySpirit[1]} <span aria-hidden="true">•</span>{" "}
          {t.mindBodySpirit[2]}
        </p>
        <h1 className="mt-1 text-5xl">{t.title}</h1>
        <p className="mt-2 max-w-2xl text-muted">
          {t.intro} {profile.share_tracking ? t.shared : t.private}
        </p>
      </div>

      {/* Habits */}
      <section className="space-y-5" aria-labelledby="habits">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="habits" className="text-3xl">
              {t.habits}
            </h2>
            <p className="text-sm text-muted">{t.habitsHint}</p>
          </div>
          {habits.length > 0 && (
            <p className="text-sm">
              {t.today}:{" "}
              <span className="font-semibold">
                {t.todayCount(todayDone, habits.length)}
              </span>
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
                    {t.thisWeek(pillarName(pillar.value))}
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
            (name) =>
              !names.has(name.toLowerCase()) &&
              !names.has(suggestion(name).toLowerCase()),
          );
          return (
            <div
              key={pillar.value}
              className="space-y-3 rounded-lg border border-border bg-surface p-4"
            >
              <h3 className="flex items-center gap-2 text-xl">
                <PillarTag pillar={pillar.value} /> {pillarName(pillar.value)}
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
                  {t.noHabits(pillarName(pillar.value))}
                </p>
              )}
              {habits.length < MAX_HABITS && suggestions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((name) => (
                    <ActionForm key={name} action={addHabit}>
                      <input
                        type="hidden"
                        name="name"
                        value={suggestion(name)}
                      />
                      <input type="hidden" name="pillar" value={pillar.value} />
                      <SubmitButton
                        pendingText={t.adding}
                        className="rounded-full border border-dashed border-border px-3 py-1 text-sm hover:border-accent"
                      >
                        + {suggestion(name)}
                      </SubmitButton>
                    </ActionForm>
                  ))}
                </div>
              )}
              {group.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted">
                    {t.removeHabit}
                  </summary>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {group.map((habit) => (
                      <li key={habit.id}>
                        <ActionForm
                          action={removeHabit}
                          confirmMessage={t.confirmRemove(habit.name)}
                        >
                          <input
                            type="hidden"
                            name="habit_id"
                            value={habit.id}
                          />
                          <SubmitButton
                            pendingText={t.removing}
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
              label={t.ownHabit}
              name="name"
              maxLength={60}
              placeholder={t.ownHabitPlaceholder}
              required
              className="field-input w-64"
            />
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t.pillar}</span>
              <select
                name="pillar"
                required
                defaultValue=""
                className="field-input"
              >
                <option value="" disabled>
                  {t.choose}
                </option>
                {PILLARS.map((pillar) => (
                  <option key={pillar.value} value={pillar.value}>
                    {pillarName(pillar.value)}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton pendingText={t.adding} className="btn-secondary">
              {t.addHabit}
            </SubmitButton>
            <div className="w-full">
              <FormStatus />
            </div>
          </ActionForm>
        ) : (
          <p className="text-sm text-muted">{t.maxHabits(MAX_HABITS)}</p>
        )}
      </section>

      {/* Body */}
      <section className="space-y-5" aria-labelledby="body">
        <div>
          <h2 id="body" className="text-3xl">
            {t.body}
          </h2>
          <p className="text-sm text-muted">{t.bodyHint}</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
          <ActionForm
            action={saveBodyLog}
            className="space-y-3 rounded-lg border border-border bg-surface p-4"
          >
            <p className="font-semibold">{t.todayDate(shortDate(today))}</p>
            <input type="hidden" name="day" value={today} />
            <Field
              label={t.weight}
              name="weight_lb"
              inputMode="decimal"
              defaultValue={todayBody?.weight_lb ?? ""}
            />
            <Field
              label={t.bodyFat}
              name="body_fat_pct"
              inputMode="decimal"
              defaultValue={todayBody?.body_fat_pct ?? ""}
            />
            <Field
              label={t.waist}
              name="waist_in"
              inputMode="decimal"
              defaultValue={todayBody?.waist_in ?? ""}
            />
            <div className="flex items-center gap-3">
              <SubmitButton pendingText={t.saving} className="btn-primary">
                {t.save}
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
                    {t.last30}{" "}
                    {change === 0
                      ? t.noChange
                      : `${change > 0 ? "+" : ""}${change} lb`}
                  </p>
                )}
              </div>
            ) : (
              <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
                {t.twoDays}
              </p>
            )}
            {bodyLogs.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t.recentBody}</caption>
                  <thead className="bg-surface text-muted">
                    <tr>
                      <th className="p-2 text-left font-medium">{t.date}</th>
                      <th className="p-2 text-right font-medium">
                        {t.weightCol}
                      </th>
                      <th className="p-2 text-right font-medium">
                        {t.bodyFatCol}
                      </th>
                      <th className="p-2 text-right font-medium">
                        {t.waistCol}
                      </th>
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
            {t.photos}
          </h2>
          <p className="text-sm text-muted">
            {t.photosHint}
            {profile.share_tracking ? t.photosShared : ""}
          </p>
        </div>
        <PhotoUpload today={today} />
        {photos.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
            {t.noPhotos}
          </p>
        ) : (
          <PhotoGallery
            photos={photos}
            locale={locale}
            renderDelete={(photo) => (
              <div className="flex items-center gap-3">
                <Link
                  href={`/community?photo=${photo.id}`}
                  className="text-xs text-muted hover:text-accent"
                >
                  {t.share}
                </Link>
                <ActionForm
                  action={deleteProgressPhoto}
                  confirmMessage={t.confirmDeletePhoto}
                >
                  <input type="hidden" name="photo_id" value={photo.id} />
                  <SubmitButton
                    pendingText={t.deleting}
                    className="text-xs text-muted hover:text-danger"
                  >
                    {t.delete}
                  </SubmitButton>
                </ActionForm>
              </div>
            )}
          />
        )}
      </section>

      {/* Nutrition */}
      <section className="space-y-5" aria-labelledby="nutrition">
        <div>
          <h2 id="nutrition" className="text-3xl">
            {t.nutrition}
          </h2>
          <p className="text-sm text-muted">{t.nutritionHint}</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
          <ActionForm
            action={saveNutritionLog}
            className="space-y-3 rounded-lg border border-border bg-surface p-4"
          >
            <p className="font-semibold">{t.todayDate(shortDate(today))}</p>
            <input type="hidden" name="day" value={today} />
            <Field
              label={t.protein}
              name="protein_g"
              inputMode="numeric"
              defaultValue={todayFood?.protein_g ?? ""}
            />
            <Field
              label={t.calories}
              name="calories"
              inputMode="numeric"
              defaultValue={todayFood?.calories ?? ""}
            />
            <Field
              label={t.water}
              name="water_glasses"
              inputMode="numeric"
              defaultValue={todayFood?.water_glasses ?? ""}
            />
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t.notes}</span>
              <textarea
                name="notes"
                rows={2}
                maxLength={500}
                defaultValue={todayFood?.notes ?? ""}
                placeholder={t.notesPlaceholder}
                className="field-input"
              />
            </label>
            <div className="flex items-center gap-3">
              <SubmitButton pendingText={t.saving} className="btn-primary">
                {t.save}
              </SubmitButton>
              <FormStatus />
            </div>
          </ActionForm>
          <div className="space-y-3">
            <dl className="grid grid-cols-3 gap-3">
              {[
                [
                  t.proteinStat,
                  averages.protein,
                  "g",
                  profile.protein_target_g,
                ],
                [t.caloriesStat, averages.calories, "", profile.calorie_target],
                [t.waterStat, averages.water, t.glasses, null],
              ].map(([label, value, unit, target]) => (
                <div
                  key={label as string}
                  className="rounded-lg border border-border bg-surface p-3"
                >
                  <dt className="text-sm text-muted">
                    {t.average(label as string)}
                  </dt>
                  <dd className="text-2xl font-semibold tabular-nums">
                    {value === null
                      ? "–"
                      : `${(value as number).toLocaleString(tag)}${unit as string}`}
                  </dd>
                  {target !== null && target !== undefined && (
                    <p className="text-xs text-muted">
                      {t.target} {(target as number).toLocaleString(tag)}
                      {unit as string}
                    </p>
                  )}
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted">{t.logged(averages.logged)}</p>
          </div>
        </div>
      </section>

      {/* Settings */}
      <section
        className="max-w-2xl space-y-3"
        aria-labelledby="tracking-settings"
      >
        <h2 id="tracking-settings" className="text-2xl">
          {t.settings}
        </h2>
        <ActionForm action={saveTrackingSettings} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t.proteinTarget}
              name="protein_target_g"
              inputMode="numeric"
              defaultValue={profile.protein_target_g ?? ""}
            />
            <Field
              label={t.calorieTarget}
              name="calorie_target"
              inputMode="numeric"
              defaultValue={profile.calorie_target ?? ""}
              hint={t.targetHint}
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
              {t.shareTracking}
              <span className="block text-muted">{t.shareTrackingHint}</span>
            </span>
          </label>
          <div className="flex items-center gap-3">
            <SubmitButton pendingText={t.saving} className="btn-secondary">
              {t.save}
            </SubmitButton>
            <FormStatus />
          </div>
        </ActionForm>
      </section>
    </div>
  );
}
