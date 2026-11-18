import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { getLocale, getT } from "@/i18n/server";
import { LOCALE_TAG } from "@/i18n/config";
import { requireAccount } from "@/lib/auth";
import { CHECKIN_SCALES } from "@/lib/checkins";
import type { MemberDailyCheckin } from "@/lib/daily-checkins";
import { todayKey } from "@/lib/reminders";
import { createClient } from "@/lib/supabase/server";
import { saveDailyCheckin } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).checkin.daily.title };
}

export default async function DailyCheckinPage() {
  const { profile } = await requireAccount();
  if (profile.role !== "member") redirect("/dashboard");

  const messages = await getT();
  const t = messages.checkin;
  const locale = await getLocale();
  const day = todayKey();
  const dayLabel = new Date(`${day}T12:00:00Z`).toLocaleDateString(
    LOCALE_TAG[locale],
    { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" },
  );
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_daily_checkins")
    .select("*")
    .eq("member_id", profile.id)
    .eq("day", day)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="text-link text-sm">
          {t.daily.backToDashboard}
        </Link>
        <h1 className="mt-2 text-5xl">{t.daily.title}</h1>
        <p className="mt-2 max-w-xl text-muted">{t.daily.intro(dayLabel)}</p>
      </div>

      {error ? (
        <p role="alert" className="max-w-2xl rounded-lg border border-danger p-4 text-danger">
          {t.daily.loadError} <Link href="/checkin/daily" className="underline">{t.daily.retry}</Link>
        </p>
      ) : (
        <ActionForm action={saveDailyCheckin} className="max-w-2xl space-y-6">
          <input type="hidden" name="expected_day" value={day} />
          {data && (
            <p className="text-sm text-success">{t.daily.alreadyDone}</p>
          )}
          {CHECKIN_SCALES.map((scale) => (
            <fieldset key={scale.key} className="space-y-2">
              <legend className="font-semibold">
                {t.scales[scale.key]?.label ?? scale.label}
              </legend>
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="w-20 text-right">
                  {t.scales[scale.key]?.low ?? scale.low}
                </span>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <label key={value} className="cursor-pointer">
                      <input
                        type="radio"
                        name={scale.key}
                        value={value}
                        defaultChecked={
                          (data as MemberDailyCheckin | null)?.[scale.key] === value
                        }
                        required
                        className="peer sr-only"
                      />
                      <span className="grid size-10 place-items-center rounded-lg border border-border bg-surface text-sm font-semibold text-foreground peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-accent">
                        {value}
                      </span>
                    </label>
                  ))}
                </div>
                <span className="w-20">
                  {t.scales[scale.key]?.high ?? scale.high}
                </span>
              </div>
            </fieldset>
          ))}
          <div className="flex items-center gap-3">
            <SubmitButton
              pendingText={t.daily.saving}
              className="btn-primary"
            >
              {data ? t.daily.update : t.daily.submit}
            </SubmitButton>
            <FormStatus />
          </div>
        </ActionForm>
      )}
    </div>
  );
}
