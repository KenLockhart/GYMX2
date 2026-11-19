import Link from "next/link";
import { ArmoryPublicHeader } from "@/components/armory-public-header";
import { T } from "@/i18n/t";
import { getCurrentAccount } from "@/lib/auth";

export default async function ArmoryCheckoutCompletePage() {
  const account = await getCurrentAccount();
  return (
    <>
      <ArmoryPublicHeader signedIn={Boolean(account)} />
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-5 px-4 py-12 sm:px-6">
        <h1 className="text-4xl"><T>Thanks for your order</T></h1>
        <p className="text-muted">
          {account ? (
            <T>Your payment is being confirmed. Your completed order will appear in My purchases.</T>
          ) : (
            <T>If your payment completed, we&apos;ll email your receipt and any download link to the address used at checkout.</T>
          )}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/armory" className="btn-primary"><T>Back to the Armory</T></Link>
          {account && <Link href="/armory/purchases" className="btn-secondary"><T>My purchases</T></Link>}
        </div>
      </main>
    </>
  );
}
