import type { Metadata } from "next";
import Link from "next/link";
import { GuestArmoryClaim } from "@/components/guest-armory-claim";
import { ArmoryPublicHeader } from "@/components/armory-public-header";
import { T } from "@/i18n/t";
import { getCurrentAccount } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Armory download",
  referrer: "no-referrer",
};

export default async function GuestArmoryClaimPage() {
  const account = await getCurrentAccount();
  return (
    <>
      <ArmoryPublicHeader signedIn={Boolean(account)} />
      <GuestArmoryClaim />
      <footer className="mx-auto w-full max-w-xl px-4 pb-8 text-sm text-muted sm:px-6">
        <Link href="/armory" className="text-link"><T>Back to the Armory</T></Link>
      </footer>
    </>
  );
}
