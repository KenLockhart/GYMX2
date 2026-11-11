import type { Metadata } from "next";
import Link from "next/link";
import { PillarTag } from "@/components/game-parts";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import { getLocale, getT } from "@/i18n/server";
import { requireAccount } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { deleteTask, setTaskCompleted } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).tasks.title };
}

type L = { t: Messages["tasks"]; locale: Locale };

type MemberAssignment = {
  id: string;
  due_on: string | null;
  completed_at: string | null;
  task: {
    title: string;
    pillar: string | null;
    instructions: string;
    video_id: string;
    video: { title: string } | null;
    coach: { display_name: string } | null;
  } | null;
};

type CoachTask = {
  id: string;
  title: string;
  pillar: string | null;
  coach: { display_name: string } | null;
  video: { id: string; title: string } | null;
  task_assignments: {
    id: string;
    due_on: string | null;
    completed_at: string | null;
    member: { display_name: string } | null;
  }[];
};

function loadError(t: Messages["tasks"]) {
  return (
    <p role="alert" className="text-danger">
      {t.loadError}
    </p>
  );
}

function AssignmentCard({
  assignment,
  t,
  locale,
}: { assignment: MemberAssignment } & L) {
  const task = assignment.task;
  if (!task) return null;
  const isDone = assignment.completed_at !== null;

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          {task.title} <PillarTag pillar={task.pillar} />
        </p>
        <p className="mt-1 text-sm text-muted">
          {[
            task.coach?.display_name,
            assignment.due_on && t.due(formatDate(assignment.due_on, locale)),
            assignment.completed_at &&
              t.done(formatDate(assignment.completed_at, locale)),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {task.instructions && (
          <p className="mt-2 max-w-2xl whitespace-pre-line text-sm">
            {task.instructions}
          </p>
        )}
        <Link
          href={`/library/${task.video_id}`}
          className="text-link mt-2 inline-block text-sm"
        >
          {t.watch(task.video?.title ?? t.theVideo)}
        </Link>
      </div>
      <ActionForm action={setTaskCompleted} className="shrink-0 space-y-2">
        <input type="hidden" name="assignment_id" value={assignment.id} />
        <input type="hidden" name="is_done" value={isDone ? "false" : "true"} />
        <SubmitButton
          pendingText={t.saving}
          className={isDone ? "btn-secondary px-3 py-2 text-sm" : "btn-primary"}
        >
          {isDone ? t.markNotDone : t.markDone}
        </SubmitButton>
        <FormStatus />
      </ActionForm>
    </li>
  );
}

async function MemberTasks({ memberId, t, locale }: { memberId: string } & L) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_assignments")
    .select(
      "id, due_on, completed_at, task:tasks(title, pillar, instructions, video_id, video:videos(title), coach:profiles!coach_id(display_name))",
    )
    .eq("member_id", memberId)
    .order("due_on", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) return loadError(t);

  const assignments = (data ?? []) as unknown as MemberAssignment[];
  const open = assignments.filter((assignment) => !assignment.completed_at);
  const done = assignments.filter((assignment) => assignment.completed_at);

  return (
    <>
      <section className="space-y-3">
        <h2 className="text-2xl">{t.toDo(open.length)}</h2>
        {open.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-muted">
            {t.nothingToDo}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {open.map((assignment) => (
              <AssignmentCard
                key={assignment.id}
                assignment={assignment}
                t={t}
                locale={locale}
              />
            ))}
          </ul>
        )}
      </section>
      {done.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-2xl">{t.doneHeading(done.length)}</h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {done.map((assignment) => (
              <AssignmentCard
                key={assignment.id}
                assignment={assignment}
                t={t}
                locale={locale}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

async function CoachTasks({
  canManage,
  t,
  locale,
}: { canManage: boolean } & L) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, pillar, coach:profiles!coach_id(display_name), video:videos(id, title), task_assignments(id, due_on, completed_at, member:profiles!member_id(display_name))",
    )
    .order("created_at", { ascending: false });
  if (error) return loadError(t);

  const tasks = (data ?? []) as unknown as CoachTask[];
  if (tasks.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface p-4 text-muted">
        {t.noneGiven}
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      {tasks.map((task) => {
        const finished = task.task_assignments.filter(
          (row) => row.completed_at,
        ).length;
        return (
          <li
            key={task.id}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {task.title} <PillarTag pillar={task.pillar} />
                </p>
                <p className="mt-1 text-sm text-muted">
                  {[
                    !canManage && task.coach?.display_name,
                    task.video?.title,
                    t.progress(finished, task.task_assignments.length),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {canManage && (
                <ActionForm
                  action={deleteTask}
                  confirmMessage={t.confirmDelete(task.title)}
                  className="shrink-0 space-y-2"
                >
                  <input type="hidden" name="task_id" value={task.id} />
                  <SubmitButton
                    pendingText={t.deleting}
                    className="btn-secondary px-3 py-2 text-sm"
                  >
                    {t.delete}
                  </SubmitButton>
                  <FormStatus />
                </ActionForm>
              )}
            </div>
            <ul className="mt-3 divide-y divide-border border-t border-border text-sm">
              {task.task_assignments.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2"
                >
                  <span>{row.member?.display_name ?? t.formerMember}</span>
                  <span
                    className={row.completed_at ? "text-success" : "text-muted"}
                  >
                    {row.completed_at
                      ? t.done(formatDate(row.completed_at, locale))
                      : row.due_on
                        ? t.due(formatDate(row.due_on, locale))
                        : t.notDoneYet}
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
  const t = (await getT()).tasks;
  const locale = await getLocale();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-5xl">{t.title}</h1>
        {profile.role === "coach" && (
          <Link href="/tasks/new" className="btn-primary">
            {t.give}
          </Link>
        )}
      </div>
      {profile.role === "member" ? (
        <MemberTasks memberId={profile.id} t={t} locale={locale} />
      ) : (
        <CoachTasks
          canManage={profile.role === "coach"}
          t={t}
          locale={locale}
        />
      )}
    </div>
  );
}
