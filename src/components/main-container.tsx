"use client";

import { usePathname } from "next/navigation";
import { AdminSidebar } from "@/components/admin-sidebar";
import { ADMIN_NAV, isActive } from "@/lib/nav";

const CONSOLE_PAGES = [
  ADMIN_NAV.overview,
  ...ADMIN_NAV.groups.flatMap((g) => g.items),
].map((e) => e.href);

// Most pages read best in a narrow column. For admins, Admin Console pages (including the ones that
// live outside /admin, like Armory sales) get the console menu beside them and more room.
export function MainContainer({
  children,
  adminBadges,
}: {
  children: React.ReactNode;
  adminBadges?: Record<string, number>;
}) {
  const pathname = usePathname();
  const inConsole =
    adminBadges !== undefined &&
    (pathname.startsWith("/admin") ||
      CONSOLE_PAGES.some((href) => isActive(pathname, href)));
  if (!inConsole)
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>
    );
  return (
    <main className="mx-auto w-full max-w-[96rem] flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <AdminSidebar badges={adminBadges} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </main>
  );
}
