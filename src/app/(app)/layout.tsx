import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import { BrandLink } from "@/components/brand-link";
import { requireAccount } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireAccount();

  // Unread messages are ones the other person sent. Row security limits this to the viewer's conversations.
  let unread = 0;
  if (profile.role !== "admin") {
    const supabase = await createClient();
    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .is("read_at", null)
      .neq("sender_id", profile.id);
    unread = count ?? 0;
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4 sm:px-6">
          <BrandLink href="/dashboard" />
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-medium">
            <Link href="/dashboard" className="hover:text-accent">
              Dashboard
            </Link>
            <Link href="/tasks" className="hover:text-accent">
              Tasks
            </Link>
            <Link href="/calendar" className="hover:text-accent">
              Calendar
            </Link>
            <Link href="/library" className="hover:text-accent">
              Library
            </Link>
            <Link href="/armory" className="hover:text-accent">
              Armory
            </Link>
            {profile.role === "member" && (
              <Link href="/coaches" className="hover:text-accent">
                Coaches
              </Link>
            )}
            {profile.role === "coach" && (
              <>
                <Link href="/members" className="hover:text-accent">
                  Members
                </Link>
                <Link href="/plans" className="hover:text-accent">
                  Memberships
                </Link>
              </>
            )}
            {profile.role === "admin" ? (
              <Link href="/admin/messages" className="hover:text-accent">
                Messages
              </Link>
            ) : (
              <Link href="/messages" className="inline-flex items-center gap-1.5 hover:text-accent">
                Messages
                {unread > 0 && (
                  <span className="rounded-full bg-accent px-1.5 text-xs font-bold text-accent-foreground">
                    {unread}
                    <span className="sr-only"> unread</span>
                  </span>
                )}
              </Link>
            )}
            <Link href="/memos" className="hover:text-accent">
              Memos
            </Link>
            {profile.role !== "admin" && (
              <>
                <Link href="/track" className="hover:text-accent">
                  Track
                </Link>
                <Link href="/progress" className="hover:text-accent">
                  Progress
                </Link>
              </>
            )}
            <Link href="/profile" className="hover:text-accent">
              Profile
            </Link>
            {profile.role === "admin" && (
              <Link href="/admin" className="hover:text-accent">
                Admin
              </Link>
            )}
            <form action={signOut}>
              <button type="submit" className="cursor-pointer text-muted hover:text-foreground">
                Log out
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
