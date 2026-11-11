import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { getCurrentAccount } from "@/lib/auth";
import { ResetPasswordForm } from "./reset-password-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).auth.reset.metaTitle };
}

export default async function ResetPasswordPage() {
  const account = await getCurrentAccount();
  if (!account) redirect("/login?error=link");
  const t = await getT();

  return (
    <>
      <h1 className="mb-6 text-4xl">{t.auth.reset.title}</h1>
      <ResetPasswordForm />
    </>
  );
}
