import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { requireAccount } from "@/lib/auth";
import {
  CHECKIN_QUESTION_MAX,
  CHECKIN_SCALES,
  CHECKIN_TEXT_MAX,
  weekLabel,
  weekStart,
  type Checkin,
} from "@/lib/checkins";
import { todayKey } from "@/lib/reminders";
import { createClient } from "@/lib/supabase/server";
import { saveCheckin } from "./actions";

export const metadata: Metadata = { title: "Weekly check-in" };

type Reply = {
  id: string;
  checkin_id: string;
  body: string;
  created_at: string;
  coach: { display_name: string } | null;
};

export default async function CheckinPage() {
  const { profile } = await requireAccount();
  if (profile.role !== "member") redirect("/checkins");

  const supabase = await createClient();
  const week = weekStart(todayKey());
  const [{ count: coachCount }, { data: checkinData }] = await Promise.all([
    supabase
      .from("coach_members")
      .select("coach_id", { count: "exact", head: true })
      .eq("member_id", profile.id),
    supabase
      .from("checkins")
      .select("*")
      .eq("member_id", profile.id)
      .order("week_start", { ascending: false })
      .limit(12),
  ]);
  const checkins = (checkinData ?? []) as Checkin[];
  const current = checkins.find((row) => row.week_start === week);
  const { data: replyData } = checkins.length
    ? await supabase
        .from("checkin_replies")
        .select(
          "id, checkin_id, body, created_at, coach:profiles!coach_id(display_name)",
        )
        .in(
          "checkin_id",
          checkins.map((row) => row.id),
        )
        .order("created_at")
    : { data: [] };
  const replies = (replyData ?? []) as unknown as Reply[];

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-5xl">Weekly check-in</h1>
        <p className="mt-2 max-w-xl text-muted">
          A minute to tell your coaches how your week went. Only you and the
          coaches you&apos;ve joined see it. Week of {weekLabel(week)}.
        </p>
      </div>

      {!coachCount ? (
        <p className="max-w-xl rounded-lg border border-border bg-surface p-4 text-muted">
          Join a coach first and your check-ins will go to them.{" "}
          <Link href="/coaches" className="text-link">
            Find a coach
          </Link>
        </p>
      ) : (
        <ActionForm action={saveCheckin} className="max-w-2xl space-y-6">
          {current && (
            <p className="text-sm text-success">
              You&apos;ve checked in this week. You can still change it until
              Sunday.
            </p>
          )}
          {CHECKIN_SCALES.map((scale) => (
            <fieldset key={scale.key} className="space-y-2">
              <legend className="font-semibold">{scale.label}</legend>
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="w-20 text-right">{scale.low}</span>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <label key={value} className="cursor-pointer">
                      <input
                        type="radio"
                        name={scale.key}
                        value={value}
                        defaultChecked={current?.[scale.key] === value}
                        required
                        className="peer sr-only"
                      />
                      <span className="grid size-10 place-items-center rounded-lg border border-border bg-surface text-sm font-semibold text-foreground peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-accent">
                        {value}
                      </span>
                    </label>
                  ))}
                </div>
                <span className="w-20">{scale.high}</span>
              </div>
            </fieldset>
          ))}
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Wins this week</span>
            <textarea
              name="wins"
              rows={3}
              maxLength={CHECKIN_TEXT_MAX}
              defaultValue={current?.wins}
              className="field-input"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">What was hard</span>
            <textarea
              name="struggles"
              rows={3}
              maxLength={CHECKIN_TEXT_MAX}
              defaultValue={current?.struggles}
              className="field-input"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">
              A question for your coach (optional)
            </span>
            <textarea
              name="question"
              rows={2}
              maxLength={CHECKIN_QUESTION_MAX}
              defaultValue={current?.question}
              className="field-input"
            />
          </label>
          <div className="flex items-center gap-3">
            <SubmitButton pendingText="Saving..." className="btn-primary">
              {current ? "Update check-in" : "Check in"}
            </SubmitButton>
            <FormStatus />
          </div>
        </ActionForm>
      )}

      {checkins.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-2xl">Past check-ins</h2>
          <ul className="space-y-3">
            {checkins.map((row) => (
              <li
                key={row.id}
                className="space-y-2 rounded-lg border border-border bg-surface p-4 text-sm"
              >
                <p className="flex flex-wrap gap-x-4 gap-y-1">
                  <span className="font-semibold">
                    Week of {weekLabel(row.week_start)}
                  </span>
                  {CHECKIN_SCALES.map((scale) => (
                    <span key={scale.key} className="text-muted">
                      {scale.label}{" "}
                      <span className="font-semibold text-foreground">
                        {row[scale.key]}
                      </span>
                      /5
                    </span>
                  ))}
                </p>
                {row.wins && <p>Wins: {row.wins}</p>}
                {row.struggles && <p>Hard: {row.struggles}</p>}
                {row.question && <p>You asked: {row.question}</p>}
                {replies
                  .filter((reply) => reply.checkin_id === row.id)
                  .map((reply) => (
                    <p
                      key={reply.id}
                      className="rounded-lg bg-surface-raised p-3"
                    >
                      <span className="font-semibold">
                        {reply.coach?.display_name ?? "Your coach"}:
                      </span>{" "}
                      {reply.body}
                    </p>
                  ))}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
