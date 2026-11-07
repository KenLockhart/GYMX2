import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAccount } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  // Checked here against the real account, not in the proxy: a session whose account is gone must
  // still reach this page, or it would bounce between here and the dashboard forever.
  if (await getCurrentAccount()) redirect("/dashboard");

  const { next, error } = await searchParams;

  return (
    <>
      <h1 className="mb-6 text-4xl">Log in</h1>
      <LoginForm
        next={next}
        initialError={
          error === "link"
            ? "That link has expired or was already used. If you were confirming your email, try logging in."
            : undefined
        }
      />
      <div className="mt-6 space-y-2 text-sm text-muted">
        <p>
          <Link href="/forgot-password" className="text-link">
            Forgot your password?
          </Link>
        </p>
        <p>
          New to GYMX2?{" "}
          <Link href="/signup" className="text-link">
            Create an account
          </Link>
        </p>
      </div>
    </>
  );
}
