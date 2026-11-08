import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCoach } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Memo } from "@/lib/types";

export const metadata: Metadata = { title: "Member" };

type Assignment = {
  id: string;
  due_on: string | null;
  completed_at: string | null;
  task: { title: string; coach_id: string } | null;
};

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireCoach();
  const { id } = await params;

  const supabase = await createClient();
  const { data: connection } = await supabase
    .from("coach_members")
    .select("member:profiles!member_id(display_name, bio)")
    .eq("coach_id", profile.id)
    .eq("member_id", id)
    .maybeSingle();
  const member = (connection as unknown as {
    member: { display_name: string; bio: string } | null;
  } | null)?.member;
  if (!member) notFound();

  const [assignmentResult, memoResult] = await Promise.all([
    supabase
      .from("task_assignments")
      .select("id, due_on, completed_at, task:tasks!inner(title, coach_id)")
      .eq("member_id", id)
      .eq("task.coach_id", profile.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("memos")
      .select("id, user_id, memo_date, body, shared_with_coaches")
      .eq("user_id", id)
      .order("memo_date", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);
  const assignments = (assignmentResult.data ?? []) as unknown as Assignment[];
  const memos = (memoResult.data ?? []) as Memo[];

  return (
    <div className="space-y-6">
      <Link href="/members" className="text-link text-sm">
        Back to members
      </Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-5xl">{member.display_name}</h1>
          {member.bio && <p className="mt-2 max-w-xl text-muted">{member.bio}</p>}
        </div>
        <Link href={`/messages/${id}`} className="btn-primary shrink-0">
          Message
        </Link>
      </div>

      <section className="space-y-3">
        <h2 className="text-2xl">Tasks from you</h2>
        {assignmentResult.error ? (
          <p role="alert" className="text-danger">
            We couldn&apos;t load these Tasks. Please refresh and try again.
          </p>
        ) : assignments.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-muted">
            You haven&apos;t given them a Task yet.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
            {assignments.map((assignment) => (
              <li key={assignment.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 p-4">
                <span className="font-semibold">{assignment.task?.title}</span>
                <span className={assignment.completed_at ? "text-success" : "text-muted"}>
                  {assignment.completed_at
                    ? `Done ${formatDate(assignment.completed_at)}`
                    : assignment.due_on
                      ? `Due ${formatDate(assignment.due_on)}`
                      : "Not done yet"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl">Shared Memos</h2>
        {memoResult.error ? (
          <p role="alert" className="text-danger">
            We couldn&apos;t load these Memos. Please refresh and try again.
          </p>
        ) : memos.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-muted">
            They haven&apos;t shared any Memos with their coaches.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {memos.map((memo) => (
              <li key={memo.id} className="p-4">
                <p className="text-sm text-muted">{formatDate(memo.memo_date)}</p>
                <p className="mt-1 whitespace-pre-line">{memo.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
