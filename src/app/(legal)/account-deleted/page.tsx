import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Account deleted" };

export default function AccountDeletedPage() {
  return (
    <article>
      <h1>Your account is deleted</h1>
      <p>
        Your GYMX2 account and everything in it is gone. We sent a confirmation
        to your email. Thanks for training with us.
      </p>
      <p>
        Changed your mind? You&apos;re always welcome back:{" "}
        <Link href="/signup">create a new account</Link>.
      </p>
    </article>
  );
}
