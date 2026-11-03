import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-6 text-4xl">Reset password</h1>
      <ForgotPasswordForm />
      <p className="mt-6 text-sm">
        <Link href="/login" className="text-link">
          Back to log in
        </Link>
      </p>
    </>
  );
}
