import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { requireAccount } from "@/lib/auth";
import {
  CHECKIN_SCALES,
  needsAttention,
  previousWeeks,
  weekLabel,
  weekStart,
  weekSummary,
  type Checkin,
} from "@/lib/checkins";
import { todayKey } from "@/lib/reminders";
import { createClient } from "@/lib/supabase/server";
import { deleteCheckinReply, replyToCheckin } from "../checkin/actions";
import { T } from "@/i18n/t";
import { getTr, getLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTr())("Check-ins") };
}

type Reply = {
  id: string;
  checkin_id: string;
  coach_id: string;
  body: string;
  coach: { display_name: string } | null;
};

// One number for a week: energy, sleep, motivation and calm (6 - stress), averaged.
const wellbeing = (row: Checkin) =>
  Math.round(
    ((row.energy + row.sleep + row.motivation + (6 - row.stress)) / 4) * 10,
  ) / 10;

export default async function CoachCheckinsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const locale = await getLocale();
  const tr = await getTr();
  const { profile } = await requireAccount();
  if (profile.role === "member") redirect("/checkin");
  if (profile.role !== "coach") redirect("/dashboard");

  const current = weekStart(todayKey());
  const weeks = previousWeeks(current, 8);
  const { week: requested } = await searchParams;
  const week = requested && weeks.includes(requested) ? requested : current;

  const supabase = await createClient();
  const [{ data: memberData }, { data: checkinData }] = await Promise.all([
    supabase
      .from("coach_members")
      .select("member:profiles!member_id(id, display_name)")
      .eq("coach_id", profile.id),
    // Row security limits this to members who joined this coach.
    supabase
      .from("checkins")
      .select("*")
      .gte("week_start", weeks[0])
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);
  const members = (
    (memberData ?? []) as unknown as {
      member: { id: string; display_name: string } | null;
    }[]
  )
    .flatMap((row) => (row.member ? [row.member] : []))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  const memberIds = members.map((member) => member.id);
  const names = new Map(
    members.map((member) => [member.id, member.display_name]),
  );
  const checkins = ((checkinData ?? []) as Checkin[]).filter((row) =>
    names.has(row.member_id),
  );
  const summary = weekSummary(memberIds, checkins, week);
  const thisWeek = checkins
    .filter((row) => row.week_start === week)
    .sort((a, b) => needsAttention(b).length - needsAttention(a).length);

  const { data: replyData } = thisWeek.length
    ? await supabase
        .from("checkin_replies")
        .select(
          "id, checkin_id, coach_id, body, coach:profiles!coach_id(display_name)",
        )
        .in(
          "checkin_id",
          thisWeek.map((row) => row.id),
        )
        .order("created_at")
    : { data: [] };
  const replies = (replyData ?? []) as unknown as Reply[];
  const byMemberWeek = new Map(
    checkins.map((row) => [`${row.member_id}:${row.week_start}`, row]),
  );

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-5xl">
            <T>Check-ins</T>
          </h1>
          <p className="mt-2 max-w-2xl text-muted">
            <T>
              Your members rate their energy, sleep, stress and motivation each
              week and share wins and struggles. Low scores show first. Members
              get a reminder on Sunday evening.
            </T>
          </p>
        </div>
        <form className="flex items-end gap-2">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">
              <T>Week of</T>
            </span>
            <select name="week" defaultValue={week} className="field-input">
              {[...weeks].reverse().map((key) => (
                <option key={key} value={key}>
                  {weekLabel(key, locale)}
                  {key === current ? tr(" (this week)") : ""}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn-secondary">
            <T>Show</T>
          </button>
        </form>
      </div>

      {members.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          <T>No members yet. Check-ins appear here once members join you.</T>
        </p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-lg border border-border bg-surface p-4 sm:col-span-1 lg:col-span-2">
              <p className="text-sm text-muted">
                <T>Checked in</T>
              </p>
              <p className="mt-1 text-3xl font-bold tabular-nums">
                {summary.checkedIn}{" "}
                <span className="text-lg text-muted">of {members.length}</span>
              </p>
              {summary.flagged > 0 && (
                <p className="mt-1 text-xs text-danger">
                  {summary.flagged} need attention
                </p>
              )}
            </div>
            {CHECKIN_SCALES.map((scale) => (
              <div
                key={scale.key}
                className="rounded-lg border border-border bg-surface p-4"
              >
                <p className="text-sm text-muted">
                  Avg. {scale.label.toLowerCase()}
                </p>
                <p className="mt-1 text-3xl font-bold tabular-nums">
                  {summary.averages[scale.key] ?? "–"}
                </p>
              </div>
            ))}
          </section>

          {summary.missing.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-2xl">
                Not checked in ({summary.missing.length})
              </h2>
              <ul className="flex flex-wrap gap-2 text-sm">
                {summary.missing.map((id) => (
                  <li key={id}>
                    <Link
                      href={`/messages/${id}`}
                      className="btn-secondary px-3 py-1.5 text-sm"
                    >
                      {names.get(id)}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-3">
            <h2 className="text-2xl">
              <T>This week&apos;s check-ins</T>
            </h2>
            {thisWeek.length === 0 ? (
              <p className="rounded-lg border border-border bg-surface p-4 text-muted">
                <T>None yet for this week.</T>
              </p>
            ) : (
              <ul className="space-y-3">
                {thisWeek.map((row) => {
                  const flags = needsAttention(row);
                  return (
                    <li
                      key={row.id}
                      className={`space-y-3 rounded-lg border bg-surface p-4 text-sm ${flags.length ? "border-danger" : "border-border"}`}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <Link
                          href={`/members/${row.member_id}`}
                          className="text-link text-base font-semibold"
                        >
                          {names.get(row.member_id)}
                        </Link>
                        {flags.length > 0 && (
                          <span className="text-xs font-semibold text-danger">
                            Check on: {flags.join(", ")}
                          </span>
                        )}
                      </div>
                      <p className="flex flex-wrap gap-x-4 gap-y-1">
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
                      {row.wins && (
                        <p>
                          <span className="text-muted">Wins: </span>
                          {row.wins}
                        </p>
                      )}
                      {row.struggles && (
                        <p>
                          <span className="text-muted">Hard: </span>
                          {row.struggles}
                        </p>
                      )}
                      {row.question && (
                        <p className="font-medium">
                          <span className="text-muted">Asks: </span>
                          {row.question}
                        </p>
                      )}
                      {replies
                        .filter((reply) => reply.checkin_id === row.id)
                        .map((reply) => (
                          <div
                            key={reply.id}
                            className="flex items-start justify-between gap-3 rounded-lg bg-surface-raised p-3"
                          >
                            <p>
                              <span className="font-semibold">
                                {reply.coach_id === profile.id
                                  ? tr("You")
                                  : (reply.coach?.display_name ?? tr("Coach"))}
                                :
                              </span>{" "}
                              {reply.body}
                            </p>
                            {reply.coach_id === profile.id && (
                              <ActionForm action={deleteCheckinReply}>
                                <input
                                  type="hidden"
                                  name="reply_id"
                                  value={reply.id}
                                />
                                <SubmitButton
                                  pendingText="..."
                                  className="text-xs text-muted hover:text-danger"
                                >
                                  <T>Remove</T>
                                </SubmitButton>
                              </ActionForm>
                            )}
                          </div>
                        ))}
                      <ActionForm action={replyToCheckin} className="space-y-2">
                        <input type="hidden" name="checkin_id" value={row.id} />
                        <label className="sr-only" htmlFor={`reply-${row.id}`}>
                          Reply to {names.get(row.member_id)}
                        </label>
                        <div className="flex gap-2">
                          <input
                            id={`reply-${row.id}`}
                            name="body"
                            maxLength={1000}
                            placeholder={tr(
                              "Reply with encouragement or advice",
                            )}
                            className="field-input min-w-0 flex-1"
                          />
                          <SubmitButton
                            pendingText={tr("Sending...")}
                            className="btn-primary px-3"
                          >
                            <T>Reply</T>
                          </SubmitButton>
                        </div>
                        <FormStatus />
                      </ActionForm>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-2xl">
              <T>Last 8 weeks</T>
            </h2>
            <p className="text-sm text-muted">
              <T>
                Wellbeing score out of 5: energy, sleep, motivation and calm
                averaged. A dash means they didn&apos;t check in.
              </T>
            </p>
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full text-sm">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="p-3 font-medium">
                      <T>Member</T>
                    </th>
                    {weeks.map((key) => (
                      <th
                        key={key}
                        className="p-3 text-right font-medium whitespace-nowrap"
                      >
                        {weekLabel(key, locale)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {members.map((member) => (
                    <tr key={member.id}>
                      <td className="p-3 whitespace-nowrap">
                        {member.display_name}
                      </td>
                      {weeks.map((key) => {
                        const row = byMemberWeek.get(`${member.id}:${key}`);
                        const low = row && needsAttention(row).length > 0;
                        return (
                          <td
                            key={key}
                            className={`p-3 text-right tabular-nums ${low ? "font-semibold text-danger" : ""}`}
                          >
                            {row ? (
                              wellbeing(row)
                            ) : (
                              <span className="text-muted">–</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
