import type { Metadata } from "next";
import Link from "next/link";
import { getT } from "@/i18n/server";
import { ForgotPasswordForm } from "./forgot-password-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).auth.forgot.metaTitle };
}

export default async function ForgotPasswordPage() {
  const t = await getT();
  return (
    <>
      <h1 className="mb-6 text-4xl">{t.auth.forgot.title}</h1>
      <ForgotPasswordForm />
      <p className="mt-6 text-sm">
        <Link href="/login" className="text-link">
          {t.auth.forgot.back}
        </Link>
      </p>
    </>
  );
}
