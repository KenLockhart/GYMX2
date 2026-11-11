import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GoalsForm } from "@/components/goals-form";
import { getT } from "@/i18n/server";
import { requireAccount } from "@/lib/auth";
import { saveOnboarding, skipOnboarding } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).welcome.title };
}

export default async function WelcomePage() {
  const { profile } = await requireAccount();
  if (profile.role !== "member") redirect("/dashboard");
  const t = (await getT()).welcome;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">
          {t.eyebrow}
        </p>
        <h1 className="mt-1 text-5xl">{t.heading}</h1>
        <p className="mt-3 max-w-xl text-muted">{t.intro}</p>
      </div>
      <GoalsForm
        action={saveOnboarding}
        initial={{
          goals: profile.goals,
          experience: profile.experience,
          focus: profile.focus,
        }}
        submitLabel={t.submit}
      />
      <form action={skipOnboarding}>
        <button
          type="submit"
          className="cursor-pointer text-sm text-muted hover:text-foreground"
        >
          {t.skip}
        </button>
      </form>
    </div>
  );
}
