import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAccount } from "@/lib/auth";
import { safeRedirectPath } from "@/lib/validation";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Came from a coach's public page? Go back to that coach after signing up.
  const destination = next ? safeRedirectPath(next) : undefined;
  if (await getCurrentAccount()) redirect(destination ?? "/dashboard");

  return (
    <>
      <h1 className="mb-6 text-4xl">Join GYMX2</h1>
      <SignupForm next={destination} />
      <p className="mt-6 text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-link">
          Log in
        </Link>
      </p>
    </>
  );
}
