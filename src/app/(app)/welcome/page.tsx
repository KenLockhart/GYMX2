import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GoalsForm } from "@/components/goals-form";
import { requireAccount } from "@/lib/auth";
import { saveOnboarding, skipOnboarding } from "./actions";

export const metadata: Metadata = { title: "Welcome" };

export default async function WelcomePage() {
  const { profile } = await requireAccount();
  if (profile.role !== "member") redirect("/dashboard");

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">
          Welcome to GYMX2
        </p>
        <h1 className="mt-1 text-5xl">Let&apos;s find your coach</h1>
        <p className="mt-3 max-w-xl text-muted">
          Three quick questions so we can suggest coaches and programs that fit.
          Only coaches you join see your answers, and you can change them any
          time on your profile.
        </p>
      </div>
      <GoalsForm
        action={saveOnboarding}
        initial={{
          goals: profile.goals,
          experience: profile.experience,
          focus: profile.focus,
        }}
        submitLabel="Show my matches"
      />
      <form action={skipOnboarding}>
        <button
          type="submit"
          className="cursor-pointer text-sm text-muted hover:text-foreground"
        >
          Skip for now
        </button>
      </form>
    </div>
  );
}
