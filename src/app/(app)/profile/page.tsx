import type { Metadata } from "next";
import Link from "next/link";
import { deletionBlocker } from "@/lib/account-deletion";
import { requireAccount } from "@/lib/auth";
import { GoalsForm, SpecialtiesForm } from "@/components/goals-form";
import { PublicPageForm } from "@/components/public-page-form";
import { PushToggle } from "@/components/push-toggle";
import { suggestSlug } from "@/lib/public-pages";
import { updateGoals, updateSpecialties } from "../welcome/actions";
import { DeleteAccountForm } from "./delete-account-form";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Your profile" };

export default async function ProfilePage() {
  const { profile, email } = await requireAccount();
  const blocker = await deletionBlocker(profile);

  return (
    <div className="space-y-10">
      <div className="space-y-6">
        <h1 className="text-5xl">Your profile</h1>
        <ProfileForm profile={profile} email={email} />
      </div>

      {profile.role === "member" && (
        <section
          id="goals"
          aria-labelledby="goals-heading"
          className="scroll-mt-6 space-y-4 border-t border-border pt-8"
        >
          <h2 id="goals-heading" className="text-2xl">
            Your goals
          </h2>
          <p className="max-w-xl text-sm text-muted">
            Used to suggest coaches. Coaches you join see these so they can
            tailor your training.{" "}
            <Link href="/welcome/matches" className="text-link">
              See your matches
            </Link>
          </p>
          <GoalsForm
            action={updateGoals}
            initial={{
              goals: profile.goals,
              experience: profile.experience,
              focus: profile.focus,
            }}
            submitLabel="Save goals"
          />
        </section>
      )}

      {profile.role === "coach" && (
        <section
          id="specialties"
          aria-labelledby="specialties-heading"
          className="scroll-mt-6 space-y-3 border-t border-border pt-8"
        >
          <h2 id="specialties-heading" className="text-2xl">
            Your specialties
          </h2>
          <p className="max-w-xl text-sm text-muted">
            New members pick their goals when they sign up. Pick what you coach
            best and you&apos;ll be suggested to members who want it.
          </p>
          <SpecialtiesForm
            action={updateSpecialties}
            initial={profile.specialties}
          />
        </section>
      )}

      {profile.role === "coach" && (
        <section
          id="public-page"
          aria-labelledby="public-page-heading"
          className="scroll-mt-6 space-y-3 border-t border-border pt-8"
        >
          <h2 id="public-page-heading" className="text-2xl">
            Public page
          </h2>
          <p className="max-w-xl text-sm text-muted">
            A page you can share on social media and in your bio so new people
            can find you and join on GYMX2.
            {profile.public_page && profile.public_slug && (
              <>
                {" "}
                <Link href={`/c/${profile.public_slug}`} className="text-link">
                  View your page
                </Link>
              </>
            )}
          </p>
          <PublicPageForm
            slug={profile.public_slug ?? suggestSlug(profile.display_name)}
            on={profile.public_page}
          />
        </section>
      )}

      <section
        id="notifications"
        aria-labelledby="push"
        className="scroll-mt-6 space-y-3 border-t border-border pt-8"
      >
        <h2 id="push" className="text-2xl">
          Phone notifications
        </h2>
        <p className="max-w-xl text-sm text-muted">
          {profile.role === "admin"
            ? "Get a notification on this device when a message needs review."
            : profile.role === "coach"
              ? "Get a notification on this device for new messages and group posts from your members."
              : "Get a notification on this device for messages, group posts, your coach going live and new program days."}{" "}
          Turn it on separately for each phone or computer you use.
        </p>
        <PushToggle
          publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
        />
      </section>

      {profile.role !== "admin" && (
        <section
          aria-labelledby="affiliate"
          className="space-y-2 border-t border-border pt-8"
        >
          <h2 id="affiliate" className="text-2xl">
            Affiliate program
          </h2>
          <p className="max-w-xl text-sm text-muted">
            Earn by bringing people to GYMX2: a share of what they buy for a
            year, plus a bonus when they make their first purchase.
          </p>
          <Link href="/affiliate" className="btn-secondary">
            Open the affiliate program
          </Link>
        </section>
      )}

      <section
        aria-labelledby="delete-account"
        className="space-y-4 border-t border-border pt-8"
      >
        <h2 id="delete-account" className="text-2xl">
          Delete your account
        </h2>
        {blocker || profile.role === "admin" ? (
          <p className="max-w-xl text-sm text-muted">{blocker}</p>
        ) : (
          <DeleteAccountForm
            role={profile.role === "coach" ? "coach" : "member"}
          />
        )}
      </section>
    </div>
  );
}
