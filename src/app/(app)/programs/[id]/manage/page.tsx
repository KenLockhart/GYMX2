import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccount } from "@/lib/auth";
import { idSchema } from "@/lib/validation";
import { isProgramPaidAuthoringEnabled, loadProgramAuthoringSnapshot } from "@/lib/program-authoring-server";
import { createClient } from "@/lib/supabase/server";
import ProgramAuthoringEditor from "./editor";

export default async function ManageProgramPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success || !isProgramPaidAuthoringEnabled()) notFound();

  const { profile } = await requireAccount();
  if (profile.role !== "coach" && profile.role !== "admin") notFound();

  const supabase = await createClient();
  const { data: program } = await supabase
    .from("programs")
    .select("id, coach_id, title, platform_owned")
    .eq("id", id)
    .maybeSingle();
  if (!program) notFound();

  const isExactOwner = program.coach_id === profile.id &&
    ((profile.role === "coach" && !program.platform_owned) ||
      (profile.role === "admin" && program.platform_owned));
  if (!isExactOwner) notFound();

  const [snapshotResult, videoResult] = await Promise.all([
    loadProgramAuthoringSnapshot({ programId: id }),
    supabase
      .from("videos")
      .select("id, title")
      .eq("coach_id", profile.id)
      .eq("status", "ready")
      .in("visibility", ["private", "program_only"])
      .order("title", { ascending: true }),
  ]);
  if (!snapshotResult.ok || snapshotResult.value.programId !== id ||
      snapshotResult.value.platformOwned !== program.platform_owned) notFound();

  const videos = (videoResult.data ?? []).map((video) => ({ id: video.id, title: video.title }));

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <Link href={`/programs/${id}`} className="text-link text-sm">Back to Program</Link>
      <header className="space-y-2">
        <p className="text-sm text-muted">Program authoring</p>
        <h1 className="text-3xl font-semibold">{program.title}</h1>
        <p className="max-w-3xl text-sm text-muted">
          Build your lessons and choose a price or payment plan. Existing free learners keep the content they joined with.
        </p>
      </header>
      <ProgramAuthoringEditor key={snapshotResult.value.programId} initialSnapshot={snapshotResult.value} readyVideos={videos} />
    </main>
  );
}
