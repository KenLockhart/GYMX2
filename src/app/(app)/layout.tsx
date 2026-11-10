import { AppHeader } from "@/components/app-header";
import { MainContainer } from "@/components/main-container";
import { loadAdminCounts, sidebarBadges } from "@/lib/admin-console-server";
import { requireAccount } from "@/lib/auth";
import {
  allDestinations,
  initials,
  menuGroups,
  messagesHref,
  primaryNav,
  type Role,
} from "@/lib/nav";
import { createClient } from "@/lib/supabase/server";

const ROLE_LABEL: Record<Role, string> = {
  member: "Member",
  coach: "Coach",
  moderator: "Moderator",
  admin: "Admin",
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireAccount();

  // Unread messages are ones the other person sent. Row security limits this to the viewer's conversations.
  let unread = 0;
  const supabase = await createClient();
  // Community notifications: row security limits this to the viewer's own.
  const { count: unreadNotifications } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", profile.id)
    .is("read_at", null);
  // Open reports for reviewers. Row security limits moderators to the shared feed and coaches to
  // their own community, and hides reports about the viewer's own posts.
  let openReports = 0;
  if (["moderator", "coach", "admin"].includes(profile.role)) {
    const { count } = await supabase
      .from("content_reports")
      .select("id", { count: "exact", head: true })
      .eq("status", "open");
    openReports = count ?? 0;
  }
  if (profile.role !== "admin") {
    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .is("read_at", null)
      .neq("sender_id", profile.id);
    unread = count ?? 0;
  }

  const role = profile.role as Role;
  const adminBadges =
    role === "admin" ? sidebarBadges(await loadAdminCounts()) : undefined;
  return (
    <div className="flex flex-1 flex-col">
      <AppHeader
        me={profile.id}
        name={profile.display_name}
        initials={initials(profile.display_name)}
        roleLabel={ROLE_LABEL[role] ?? "Member"}
        primary={primaryNav(role)}
        groups={menuGroups(role)}
        destinations={allDestinations(role)}
        messagesHref={messagesHref(role)}
        messagesLabel={role === "admin" ? "Review conversations" : "Messages"}
        unreadMessages={unread}
        unreadNotifications={unreadNotifications ?? 0}
        badges={openReports > 0 ? { "/moderation": openReports } : {}}
      />
      <MainContainer adminBadges={adminBadges}>{children}</MainContainer>
    </div>
  );
}
