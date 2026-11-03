import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <>
      <h1 className="mb-6 text-4xl">Log in</h1>
      <LoginForm
        next={next}
        initialError={
          error === "link" ? "That link has expired or was already used. Please try again." : undefined
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
