import Link from "next/link";
import { BrandLink } from "@/components/brand-link";

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <BrandLink />
        <Link href="/login" className="text-link">
          Log in
        </Link>
      </header>
      <main className="legal flex-1 py-8 sm:py-12">{children}</main>
    </div>
  );
}
