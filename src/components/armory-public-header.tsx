import Link from "next/link";
import { BrandLink } from "@/components/brand-link";
import { T } from "@/i18n/t";

export function ArmoryPublicHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <BrandLink />
        <nav aria-label="Armory navigation" className="flex flex-wrap items-center gap-4 text-sm">
          <Link href="/armory" className="font-semibold text-link"><T>The Armory</T></Link>
          <Link href="/armory/apparel" className="text-link"><T>Apparel</T></Link>
          {signedIn ? (
            <>
              <Link href="/armory/purchases" className="text-link"><T>My purchases</T></Link>
              <Link href="/dashboard" className="text-link"><T>Dashboard</T></Link>
            </>
          ) : (
            <>
              <Link href="/login" className="text-link"><T>Log in</T></Link>
              <Link href="/signup" className="btn-secondary px-3 py-2"><T>Create account</T></Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
