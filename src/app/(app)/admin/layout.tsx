import { requireAdmin } from "@/lib/auth";

// Every admin page also checks for itself; this makes sure nothing under /admin slips through.
// The Admin Console menu is drawn by the app layout, so pages outside /admin keep it too.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();
  return children;
}
