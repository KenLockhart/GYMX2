import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { getCurrentAccount } from "@/lib/auth";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).auth.login.title };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  // Checked here against the real account, not in the proxy: a session whose account is gone must
  // still reach this page, or it would bounce between here and the dashboard forever.
  if (await getCurrentAccount()) redirect("/dashboard");

  const { next, error } = await searchParams;
  const t = await getT();

  return (
    <>
      <h1 className="mb-6 text-4xl">{t.auth.login.title}</h1>
      <LoginForm
        next={next}
        initialError={error === "link" ? t.auth.login.linkExpired : undefined}
      />
      <div className="mt-6 space-y-2 text-sm text-muted">
        <p>
          <Link href="/forgot-password" className="text-link">
            {t.auth.login.forgot}
          </Link>
        </p>
        <p>
          {t.auth.login.newHere}{" "}
          <Link href="/signup" className="text-link">
            {t.auth.login.createAccount}
          </Link>
        </p>
      </div>
    </>
  );
}
