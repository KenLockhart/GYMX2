import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { requireAccount } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { deleteTask, setTaskCompleted } from "./actions";

export const metadata: Metadata = { title: "Tasks" };

type MemberAssignment = {
  id: string;
  due_on: string | null;
  completed_at: string | null;
  task: {
    title: string;
    instructions: string;
    video_id: string;
    video: { title: string } | null;
    coach: { display_name: string } | null;
  } | null;
};

type CoachTask = {
  id: string;
  title: string;
  coach: { display_name: string } | null;
  video: { id: string; title: string } | null;
  task_assignments: {
    id: string;
    due_on: string | null;
    completed_at: string | null;
    member: { display_name: string } | null;
  }[];
};

function loadError() {
  return (
    <p role="alert" className="text-danger">
      We couldn&apos;t load your Tasks. Please refresh and try again.
    </p>
  );
}

function AssignmentCard({ assignment }: { assignment: MemberAssignment }) {
  const task = assignment.task;
  if (!task) return null;
  const isDone = assignment.completed_at !== null;

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="font-semibold">{task.title}</p>
        <p className="mt-1 text-sm text-muted">
          {[
            task.coach?.display_name,
            assignment.due_on && `Due ${formatDate(assignment.due_on)}`,
            assignment.completed_at && `Done ${formatDate(assignment.completed_at)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {task.instructions && (
          <p className="mt-2 max-w-2xl whitespace-pre-line text-sm">{task.instructions}</p>
        )}
        <Link href={`/library/${task.video_id}`} className="text-link mt-2 inline-block text-sm">
          Watch: {task.video?.title ?? "the video"}
        </Link>
      </div>
      <ActionForm action={setTaskCompleted} className="shrink-0 space-y-2">
        <input type="hidden" name="assignment_id" value={assignment.id} />
        <input type="hidden" name="is_done" value={isDone ? "false" : "true"} />
        <SubmitButton
          pendingText="Saving..."
          className={isDone ? "btn-secondary px-3 py-2 text-sm" : "btn-primary"}
        >
          {isDone ? "Mark as not done" : "Mark as done"}
        </SubmitButton>
        <FormStatus />
      </ActionForm>
    </li>
  );
}

async function MemberTasks({ memberId }: { memberId: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_assignments")
    .select(
      "id, due_on, completed_at, task:tasks(title, instructions, video_id, video:videos(title), coach:profiles!coach_id(display_name))",
    )
    .eq("member_id", memberId)
    .order("due_on", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) return loadError();

  const assignments = (data ?? []) as unknown as MemberAssignment[];
  const open = assignments.filter((assignment) => !assignment.completed_at);
  const done = assignments.filter((assignment) => assignment.completed_at);

  return (
    <>
      <section className="space-y-3">
        <h2 className="text-2xl">To do ({open.length})</h2>
        {open.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-muted">
            Nothing to do right now. Your coach&apos;s Tasks will appear here.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {open.map((assignment) => (
              <AssignmentCard key={assignment.id} assignment={assignment} />
            ))}
          </ul>
        )}
      </section>
      {done.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-2xl">Done ({done.length})</h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {done.map((assignment) => (
              <AssignmentCard key={assignment.id} assignment={assignment} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

async function CoachTasks({ canManage }: { canManage: boolean }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, coach:profiles!coach_id(display_name), video:videos(id, title), task_assignments(id, due_on, completed_at, member:profiles!member_id(display_name))",
    )
    .order("created_at", { ascending: false });
  if (error) return loadError();

  const tasks = (data ?? []) as unknown as CoachTask[];
  if (tasks.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface p-4 text-muted">
        No Tasks have been given yet.
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      {tasks.map((task) => {
        const finished = task.task_assignments.filter((row) => row.completed_at).length;
        return (
          <li key={task.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold">{task.title}</p>
                <p className="mt-1 text-sm text-muted">
                  {[
                    !canManage && task.coach?.display_name,
                    task.video?.title,
                    `${finished} of ${task.task_assignments.length} done`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {canManage && (
                <ActionForm
                  action={deleteTask}
                  confirmMessage={`Delete "${task.title}"? Members will lose it too.`}
                  className="shrink-0 space-y-2"
                >
                  <input type="hidden" name="task_id" value={task.id} />
                  <SubmitButton pendingText="Deleting..." className="btn-secondary px-3 py-2 text-sm">
                    Delete
                  </SubmitButton>
                  <FormStatus />
                </ActionForm>
              )}
            </div>
            <ul className="mt-3 divide-y divide-border border-t border-border text-sm">
              {task.task_assignments.map((row) => (
                <li key={row.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2">
                  <span>{row.member?.display_name ?? "Former member"}</span>
                  <span className={row.completed_at ? "text-success" : "text-muted"}>
                    {row.completed_at
                      ? `Done ${formatDate(row.completed_at)}`
                      : row.due_on
                        ? `Due ${formatDate(row.due_on)}`
                        : "Not done yet"}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

export default async function TasksPage() {
  const { profile } = await requireAccount();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-5xl">Tasks</h1>
        {profile.role === "coach" && (
          <Link href="/tasks/new" className="btn-primary">
            Give a Task
          </Link>
        )}
      </div>
      {profile.role === "member" ? (
        <MemberTasks memberId={profile.id} />
      ) : (
        <CoachTasks canManage={profile.role === "coach"} />
      )}
    </div>
  );
}
