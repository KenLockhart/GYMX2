import Link from "next/link";
import { BrandLink } from "@/components/brand-link";

export default function PublicCoachLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <BrandLink />
          <nav className="flex items-center gap-4 text-sm font-medium">
            <Link href="/login" className="hover:text-accent">
              Log in
            </Link>
            <Link href="/signup" className="btn-primary px-3 py-2 text-sm">
              Join GYMX2
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
        {children}
      </main>
    </div>
  );
}
