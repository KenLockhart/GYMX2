import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { getCurrentAccount } from "@/lib/auth";
import { safeRedirectPath } from "@/lib/validation";
import { SignupForm } from "./signup-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).auth.signup.metaTitle };
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Came from a coach's public page? Go back to that coach after signing up.
  const destination = next ? safeRedirectPath(next) : undefined;
  if (await getCurrentAccount()) redirect(destination ?? "/dashboard");
  const t = await getT();

  return (
    <>
      <h1 className="mb-6 text-4xl">{t.auth.signup.title}</h1>
      <SignupForm next={destination} />
      <p className="mt-6 text-sm text-muted">
        {t.auth.signup.haveAccount}{" "}
        <Link href="/login" className="text-link">
          {t.auth.signup.login}
        </Link>
      </p>
    </>
  );
}
