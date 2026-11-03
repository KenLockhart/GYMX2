import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentAccount } from "@/lib/auth";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  const account = await getCurrentAccount();
  if (!account) redirect("/login?error=link");

  return (
    <>
      <h1 className="mb-6 text-4xl">New password</h1>
      <ResetPasswordForm />
    </>
  );
}
